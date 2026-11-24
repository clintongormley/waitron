# Backlog — what to work on next, and why

This file answers **"what should I work on?"** It is state, not history: the open work, grouped by
area under _Open work, by area_, the order to take it in, and one row per sub-project of what is
built. Finished work is not listed here: the git log, the PR threads, and the committed
specs/plans in `docs/superpowers/` hold it — do not paste receipts back in here. A long entry keeps
its first lines here and its whole text in its area's detail file under `docs/backlog/`.

> **The goal is a standalone working primary on prem** (2026-09-12). The on-prem mirror and the
> cloud primary stay on the list, but they come afterwards. What a review seat caught and how
> something was proven stay in the PR thread.

**Companion documents, not duplicated here:**

- **[Cloud documentation ownership](cloud-ownership.md)** and the
  **[Waitron Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)**
  own cloud services and infrastructure. This backlog retains the node application's
  integration work and shared technical prerequisites.
- **[ui-review.md](ui-review.md)** — the live tracker for the UI/UX walkthrough: which areas
  are examined, which remain, and the corrections logged against each.
- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal/administrative track
  (certificates, company formation, the declaración responsable).
- **[compliance/asesor-questions.md](compliance/asesor-questions.md)** and
  **[compliance/asesor-laboral-questions.md](compliance/asesor-laboral-questions.md)** — the fiscal
  and labour advisor question lists (see _The advisor gap_, at the end).
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects (the strategy; changes rarely).

---

## How the order is decided

- **The north star (revised 2026-09-12): a standalone on-prem primary a real operator can install
  and run.** A blank box to selling, printing, paying and closing, with its backups leaving the box
  and the things that go wrong visible on a screen. **Afterwards, in this order:** the on-prem mirror
  it can fail over to, then a cloud primary. Waitron Cloud product planning and service work are
  tracked in its [own backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md).
  Every node decision must keep the application usable in the cloud (the rules below).
- **Soundness, not the calendar** (2026-08-02). Waitron will be finished before the deli must trade,
  so 1-Jan-2027 ranks nothing above anything. Order by dependency, correctness, and de-risking the
  most-reused or most-uncertain foundations first.
- **A PR that changes invoices, the Veri\*Factu record chain, invoice series or AEAT filing waits
  for the owner to land it; everything else lands itself** (owner, 2026-10-21).
- **Docs land direct to `main`** (2026-08-02): the `main protection` ruleset grants Repository-admin a
  bypass, so a docs-only change is branched, `commit -s`, fast-forwarded and pushed — no PR, no CI
  wait. Feature and code changes still go through a PR.
- **Residency:** the Spanish rollout retains Spain as its hosting target (owner, 2026-09-05).
  Country placement for the wider Cloud product is now discussed in
  [Waitron Cloud](https://github.com/waitron-io/waitron-cloud/blob/main/docs/product-and-platform.md).

**The shape we build for:**

- **One venue and one taxpayer per operational node group** (2026-09-09). One active primary, one or
  more warm mirrors, human promotion. Restaurant/bar and deli can be departments within the same
  venue and share preparation. A taxpayer with independent venues has separate node groups; shared
  cloud management sits above them.
- **A mirror is on prem or in the cloud and is reached the same way** — URL + credentials over the
  same replication link. A cloud mirror is reached over WireGuard, so two containers on one machine
  joined by WireGuard IS the cloud test.
- **Product images live in the venue database (`venue.db`) and are served from it** (2026-09-08).
  Replication, backup, restore and a cloud move are then one mechanism. Original and replacement
  source URLs hash immutable bytes. A stable photo reference resolves its current small rendition
  through a recipe URL containing source, framing and version; changing the picture or framing
  produces a new recipe. The rendition cache can be rebuilt from the database.
- **Backups leave the primary.** Destinations, in build order now that the mirror comes afterwards
  (2026-09-12): an S3-compatible bucket, Google
  Drive, then the mirror once it exists. All three hang off the existing `StorageBackend` seat.

**Cloud-compatibility rules** — a change that breaks one is a design question, never a default:

1. Peers are reached by URL + credentials only. No LAN discovery, no shared-subnet assumption.
2. Adopt, promote, rejoin and backup are ONE code path wherever the node sits.
3. Every two-node test runs twice: over the plain LAN and over a WireGuard fixture. The one built in
   #275 (`two-node-wireguard.ts`) was deleted with PostgreSQL in #489; none exists today.
4. Everything a node keeps on disk, `venue.db` included, is in a named volume, and every secret can
   come from the environment as well as a file.
5. The print agent is its own process on the venue's LAN, dialling OUT to the primary by URL. It is
   the one piece that must stay on prem when the primary is in the cloud.

---

## What to work on next

Ordered by the owner's backlog review of 6 November 2026, on dependency, correctness and what removes
the most risk, never on dates. Each bundle is one pull request. The review's working files are in
`~/waitron-campaign-shared/backlog-review-2026-11-06/`.

**1. The owner's sessions, which need no building.**

- Get the tax adviser's details on the owner's answers of 18 November on the
  [19 November sheet](compliance/2026-11-19-adviser-meeting.md) (owner, 2026-11-18: the answers
  there are the owner's own, and the adviser will come back with more). Still open even in the
  owner's answers: drinks served without food (question 4), tips (7), a wrong time on the right
  day (8), the declaration's items d) and f) (9), and a copy's header and logo and which records
  are kept ten years (10). Question 11's labour, privacy and selling-by-weight questions still
  need advisers of their own.
- [One session at the real box: printers, paper, tax QR, the drawer](backlog/printers.md#bundle-one-session-at-the-real-box-printers-paper-tax-qr-the-drawer)
- [One session with real phones and password managers](backlog/dashboard.md#bundle-one-session-with-real-phones-and-password-managers)
- [One owner session with a real certificate against AEAT](backlog/fiscal.md#bundle-one-owner-session-with-a-real-certificate-against-aeat)

**2. Go-live fixes that can start today.** They add no tables and no lane holds them. Till bundles
run one after another, because they share `apps/till/src/till-app.ts`.

- [A950. Automatic upgrades with rollback](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order). Automation remains in the [upgrade plan](superpowers/plans/2026-11-09-a950-shorter-upgrades.md).

**3. The foundation, already running.** A1308 stays first in lane A, with
[Small checks and indexes that are cheap only inside A1308's fresh tables](backlog/architecture.md#bundle-small-checks-and-indexes-that-are-cheap-only-inside-a1308s-fresh-tables). A1306's history rewrite is A1308's last step (owner, 2026-11-06).

**4. Released by the hold, once A760 lands.** Build order (A446's pre-bill is not scheduled, owner
2026-11-17):
the handover bundles.

- [Series and module-preparation gaps at handover](backlog/replication-cloud.md#bundle-series-and-module-preparation-gaps-at-handover)
- [Finish the clock work: a check at every start and every change](backlog/box.md#bundle-finish-the-clock-work-a-check-at-every-start-and-every-change)
- [Query plans and indexes, measured on a year of data](backlog/architecture.md#bundle-query-plans-and-indexes-measured-on-a-year-of-data)
- [The spare's wait loop: back-off, reasons, stop signals](backlog/replication-cloud.md#bundle-the-spares-wait-loop-back-off-reasons-stop-signals): chart answers and accepted-copy recognition.
- [Remaining setup and failover gaps](backlog/replication-cloud.md#bundle-remaining-setup-and-failover-gaps)
- [Everything needing a third box or a Cloud peer](backlog/replication-cloud.md#bundle-everything-needing-a-third-box-or-a-cloud-peer)
- [Get ready for A1308's history rewrite (A1306 and CI's concurrency groups)](backlog/ci.md#bundle-get-ready-for-a1308s-history-rewrite-a1306-and-cis-concurrency-groups)

**5. Important work.** The bundles marked important under each area, taken by theme so that a lane
stays in one area.

**6. After the first venue.** The remaining bundles, which are nice to have. Take
them only when a lane has nothing better.

**Features the owner ranked on 2026-10-16 that are still open:** A803 bills and tables, and A664 archiving or deleting old data.

**Remote access unblocks the customer-facing features, so it comes first among them (owner,
2026-10-22).** Online booking (A1013), the table's QR code (A508), online ordering for collection
(A509) and delivery (A1012) all reach the box through the venue's Cloud instance. They come soon
after go-live, not at it. This repository's part is **A951**, the box's lasting tunnel and
public-certificate client. **A1175**, an Android app for venues run from Waitron Cloud, joins this
group (owner, 2026-10-28).

---

## Open work, by area

Every open entry is here, under its area. The areas replaced the old Tracks A, B and C,
_Afterwards_ and _Detail_ (A430,
[plan](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/plans/2026-10-08-a430-backlog-open-work-only.md)); each area's italic
"Formerly …" line names the old sections it absorbed, so an old pointer such as "A4" still finds
its place. A long entry keeps its first lines here and its whole text in the area's detail file
under `docs/backlog/`. Small related fixes are one **bundle** line here, with each fix's text under
that bundle's heading in the area's file: take a bundle as one pull request.

### Fiscal records, invoices and the asesor

- **Make `packages/provisioning`'s tests regime-agnostic** (fiscal; the owner lands it): point the
  ones that do not test a fiscal regime at `fiscal-none` rather than `fiscal-verifactu`. Left open
  by #3461, which removed the Verifactu backend's unused `resolveClient` and `skipRetryMs`.

- **Retire the historical allocation formats from `fiscal-verifactu`.** Historical code still
  reads signed paper, Cloud receipts and emergency names, and three Cloud settings whose only
  guide was deleted. Removing it changes activation, so it is its own fiscal change for the owner
  to land. Left open by A1189.
  [Detail](backlog/fiscal.md#retire-the-historical-allocation-formats-from-fiscal-verifactu)

- **Invoice context qualification:** Exercise full-invoice print delivery and PDF downloads with
  distinct serving-node and data-node contexts, including practice marking. The A1156 review's
  print-delivery override survived the reprint-only controls; existing delivery/PDF suites remain.

- **A1089: repair persistent AEAT certificate-check failures in the app.** Read-only
  diagnosis distinguishes saved facts, current material and observed query results, with
  sign-in, Stop and explicit copy at the action. It does not repair network/configuration
  problems or a persistent external refusal. Design the applicable repair choices without
  treating an HTTP status, another check or a completed query as proof of the cause.
  Keep the installed certificate until a replacement passes its checks.
  [Remaining workflow](backlog/self-service-refusals.md#certificate).

- **A1089: reconciliation alerts need an evidence/decision route.** A module-owned startup/daily
  caller (W41s-10a, #2449) runs scoped to node, taxpayer and environment, separately from payment
  reconciliation. The older caller audits are historical. Inspect retained findings before
  offering decisions for persistent mismatches; a local queue-reset marker does not prove another
  submission occurred. [Audit and remaining work](backlog/self-service-refusals.md#fiscal-reconcile).

  The [inspection and caller-scope proposal](superpowers/specs/2026-10-29-a1089-fiscal-reconcile-recovery-design.md)
  and [implementation plan](superpowers/plans/2026-10-29-a1089-fiscal-reconcile-evidence.md)
  follow the owner's 29 October evidence-first decision. The owner retired its separate evidence
  branch on 2026-11-10; its evidence belongs on Reporting → Fiscal filing. W41s-9 (2026-11-14)
  reworded both alerts without a support referral; their evidence is not yet on Fiscal filing. A
  local queue-reset marker does not prove a repeat submission; persistent recovery remains open.

- **A1089: fiscal environment refusals need safe configuration or recovery guidance.** Separate a wrong host environment from missing immutable metadata. Never relabel records, promote test data or reset invoice numbering.
  [Audit](backlog/self-service-refusals.md#fiscal-environment).
  The owner retired this item's separate evidence screen on 2026-11-10. W41s-9's evidence step
  (2026-11-14) added nothing for these two alerts on the watcher's choice (a) of 2026-11-14 03:20,
  and reworded both so neither says "Contact support". The trace behind that choice, traced, not
  run: a record's environment is the process's own (`apps/server/src/boot.ts:3240`) and the drain
  compares it with the same value (`boot.ts:4260`, `drain.ts:698-711`); a start whose environment
  differs from the database's stamp is refused (`apps/server/src/deployment-guard.ts:27-31`, called at
  `boot.ts:1319`); and every path that creates a venue database stamps it before its first record:
  first setup (`packages/provisioning/src/first-setup-command-deployment.ts:286`), provisioning
  (`apps/server/src/provision.ts:144`) and adoption (`apps/server/src/adopt.ts:233`), while a
  restore of a backup from the other environment is refused (`apps/server/src/restore-gate.ts:20`).
  So a mismatch is unreachable only while every setup path stamps first; the start check over an
  unstamped database does not cover the rest (a reviewer's throwaway test started a test box over
  unstamped production records). `fiscal.environment_unknown` needs a record with no environment,
  which only test fixtures write. The
  [implementation plan](superpowers/plans/2026-10-29-a1089-fiscal-environment-evidence.md) keeps the
  source audit. Persistent repair from the running dashboard remains open; the startup database
  guard also applies. A1501 supplies the wrong-environment failed-start Move/Stop route; it never
  relabels the retained database.

- **A1089: a fiscal reply-line mismatch needs accurate retry and evidence choices.** Describe only the drain behavior actually exercised, then offer evidence inspection and a decision path for persistent malformed replies, with any required sign-in there.
  [Audit](backlog/self-service-refusals.md#fiscal-reply).
  The [inspection design](superpowers/specs/2026-10-28-a1089-fiscal-reply-recovery-design.md) and
  [implementation plan](superpowers/plans/2026-10-29-a1089-fiscal-reply-evidence.md) keep the source
  audit. The evidence is on **Reporting → Fiscal filing** under **Warnings** (W41s-9, 2026-11-14):
  the records sent, their state now and AEAT's lines; the bell's alert opens the page and no longer
  says "Contact support". The lines shown are the first kept while the alert is open, not
  necessarily the latest reply. What remains is a persistent repair or decision route, which needs
  its own owner decision.

- **A1089: fiscal filing-case alerts need a real decision route.** The evidence page exists: **Reporting → Fiscal filing** (W41s-9 slice 1, 2026-11-10), which the bell's filing alerts open. Its two decisions: for a sale AEAT refused with code 1100 whose message names the operation description, an administrator may send a correction record with a new description; for an invoice AEAT refused for a future date (code 1112), an administrator may issue a replacement corrective invoice carrying the day the sale really happened (Q37-FIX; a full invoice only once A1407's switch is on). Every other case still waits for the page to offer W41s-8's other remedies; until then keep the missing workflow explicit. A corrective refused for a future date (`1112`) has no fix on the page, and a refusal about the customer block (AEAT `1193`, `2001`) has no writer at all. Rejections, cancellations, duplicate conflicts and repeated refusals cannot be fixed by an invented retry screen.
  [Audit](backlog/self-service-refusals.md#fiscal-cases).

- **A1089: fiscal integrity and validation alerts need evidence-preserving next steps.** Replace support-only guidance without editing records or treating every warning as a proven Waitron bug. A substantial missing recovery workflow requires an owner decision.
  [Audit](backlog/self-service-refusals.md#fiscal-integrity).
  Local validation warnings (`fiscal.record_flagged`, `fiscal.record_totals_disagree`) are on
  **Reporting → Fiscal filing** under **Warnings** (W41s-9, 2026-11-14): the invoice, when exactly
  one record of the sale was made in the warning's second, and its fields and check codes; the
  bell's alerts open the page. `chain.verification_failed` has no section (watcher, 2026-11-14 03:20); its
  alert was reworded to say what happened and that sales and filing carry on, without "Contact
  support". `fiscal.fingerprint_mismatch` adds nothing to the page (no record, no params) and keeps
  its alert. What remains is a persistent repair or decision route, which needs its own owner
  decision, and whole-chain auditing. The
  [proposal](superpowers/specs/2026-10-29-a1089-fiscal-integrity-recovery-design.md) retains the
  source audit. Inspection does not establish AEAT acceptance.

_Formerly A1 (with A1a–A1e, A231, A231d, A275 and W41s), and the old Track C's fiscal items; part of A9._ Detail: [backlog/fiscal.md](backlog/fiscal.md).

- **A940. Waitron's declaración responsable — design approved 2026-10-22; slice 1 landed 2026-10-23 (#2000).**
  Task 8 landed: the producer's name, tax number and postal address are three public settings each official image carries from repository secrets, never committed; a production start refuses without them. The three secrets hold placeholder values for now (owner, 2026-11-08); replace them (`gh secret set --env-file ~/waitron-campaign-shared/private/producer-identity.env --app actions --repo clintongormley/waitron`) before any box starts in production, because a later change opens a new fiscal installation on each production box ([runbook](operations/release.md#when-the-producer-or-the-system-code-changes)); every full run's publish job fails while any is missing; once an image carrying a placeholder is published, the publish job also refuses the real tax number unless the repository variable `WAITRON_PRODUCER_CHANGE_ALLOWED` holds it; watch the first nightly or manual publish (its load-then-push build had not run on GitHub before). The real-fork test (the plan's 8g Step 5) is still to do. Slice 2 landed (#2820, #2827 and #2836): the text, its renderer, the A4 PDF's renderer, the package's `declaration` command, and `pnpm release prepare` and `pnpm release tag` with their [runbook](operations/release.md). Both release commands run since the template's release-blocker line was deleted on 22 November; version 0.1.0's item d) is Q53's draft (owner: "Just put in whatever we have for now, we can update it later"). Slice 3 landed (#2861, #2874, #2916, #2974; [plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-11-a940-3-in-app-declaration.md)): every box, in every state and on every listener, answers `/legal/declaration` (and `.pdf`, `.txt`) and `/legal/about`, and says it has no declaration when its image carries none; every terminal opens it: the dashboard's account menu and sign-in screen open About Waitron; on the till, More holds About Waitron just above Log out, and a kitchen screen's corner, the till's sign-in and join screens and the setup wizard have an ⓘ that opens it; the guide's About Waitron page says where to find it. Slice 4 landed (#2987, #3001, #3014; [plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a940-4-release-image.md)): a `v1.2.3` tag on `main` publishes an image whose records say `1.2.3` and which carries that version's declaration; CI refuses a tag off `main`, a bad version, a missing, blocked or disagreeing declaration, or a version already published; the GitHub Release gets the declaration's PDF and text from the published image; `waitron.sh install v1.2.3` pulls it; a production start on a bundle that is not a release refuses `server.unreleased_build`; a root guard fails when a released declaration changes or its tag is missing. So an official image refuses a production start unless it was built from a release tag (a start from source is not refused). Slice 5 landed (#3051; [plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-13-a940-5-kept-declarations.md)): a box that starts selling keeps its release's declaration in the venue database, and the declaration page lists each earlier version kept under «Versiones anteriores». Slice 6's library half landed (waitron-io/verifactu#152; [plan](superpowers/plans/2026-11-14-a940-6-library-declaration.md)): from 0.3.0 each `@waitron/verifactu` release carries its own declaration on its GitHub Release and inside the npm package, and AEAT's demand service is removed. Still open: releasing 0.3.0, which waits for the asesor's Q53 answer and for the owner to set `WAITRON_PRODUCER_NAME`, `WAITRON_PRODUCER_TAX_ID`, `WAITRON_PRODUCER_ADDRESS` (secrets) and `DECLARATION_PLACE` (variable) on waitron-io/verifactu; then Waitron moves to `^0.3.0`, item d) says again that the library has its own declaration, and `pnpm release prepare` refuses a library with no declaration.
  Still needed from outside, for the next version's declaration: the asesor's answer to Q53, now question 9 of the [19 November adviser sheet](compliance/2026-11-19-adviser-meeting.md); the owner's answers of 18 November leave items d) and f) to be confirmed. The owner's publishable address is settled (supplied 2026-11-04; it travels with the other two).
  [Detail](backlog/fiscal.md#a940-waitrons-declaración-responsable--design-approved-2026-10-22-slice-1-landed-2026-10-23-2000).

- **One owner session with a real certificate against AEAT** (bundle of 3, 3 important, size S, needs a third party). Holds A1270, A888, A679. [Detail](backlog/fiscal.md#bundle-one-owner-session-with-a-real-certificate-against-aeat)

- **Structured B2B invoices before the applicable 2027 or 2028 date.** Establish the issuer's threshold and recipient scope, then build structured exchange and required reporting. Current paper/email qualification stays separate.
  [Detail](backlog/fiscal.md#structured-b2b-invoices-before-the-applicable-2027-or-2028-date).

- **A446. Build the pre-bill: each printed pre-bill is stored as printed and linked to the invoice that follows — NOT SCHEDULED: it stays on the backlog for the foreseeable future (owner, 2026-11-17: "the printed pre-bill, leave it on the backlog for the foreseeable future").** A table's ticket is issued when staff print the bill instead (decision D1). The design stays A803 §3.9, kept as written. The owner's answer (owner, 2026-11-18, question 2 of the [19 November sheet](compliance/2026-11-19-adviser-meeting.md)): no pre-bill is needed, and a bill changed after it is issued takes a corrective or a cancellation; the adviser is still to confirm the details.
  [Detail](backlog/fiscal.md#a446-build-the-pre-bill-each-printed-pre-bill-is-stored-as-printed-and-linked-to-the-invoice-that-follows).

- **A447. A part payment whose payer wants a receipt is an advance.** Owner, 2026-11-19 (decision D1 and the 20:30 answers): a part payment during the meal is an advance, with its own invoice and VAT, only when its payer wants their own receipt, and the final ticket takes it off; the adviser is still to confirm the details. The till's advance ticket is built; left are an advance as a full invoice and an advance paid before the day. Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a447-a-part-payment-whose-payer-wants-a-receipt-is-an-advance).

- **A448. Whether a customer's email address alone satisfies TRLGDCU art. 63.3 for an emailed full invoice.**
  [Detail](backlog/fiscal.md#decisions-and-deliberate-limits) _2026-10-12: the product no longer asks for consent at all — A231q's tasks C1a and C1b
  removed it on the owner's 2026-10-09 answer. Until 2026-10-12 this entry asked
  that the consent request say how the invoice will arrive and how consent is withdrawn._

- **The till's email step does not tell the customer how the ticket arrives** (left open by ADVISER-NO-NONE, which
  removed the till's None). Question 3 of the [19 November sheet](compliance/2026-11-19-adviser-meeting.md) tells the
  adviser the till says "We'll email your ticket to this address. You can ask for a paper copy at any time."; the till's
  strings (`apps/till/src/i18n/strings.ts`) hold no such sentence, and the adviser's answer on consent to email rests on it.

- **Loose ends left by A230 (`@waitron/verifactu` 0.2.1, #1099).**
  An unusable `TiempoEsperaEnvio` is not recorded anywhere (the raw value is dropped).
  [Detail](backlog/fiscal.md#loose-ends-left-by-a230-waitronverifactu-021-1099)

- **Owner decision 2026-09-24: a void counts on the day it is made, not the day of the sale** —
  The _modelo 303_ file counts a void made by the last day of its sale's period in that period; a void made later leaves that period's file as it was and goes on the corrections workbook of the period it is made in, listed against the sale's period. That settles Q25 (which VAT period a later annulment lands in) by owner decision D12, which the owner's answer of 18 November keeps (owner, 2026-11-18, question 8 of the [19 November sheet](compliance/2026-11-19-adviser-meeting.md)); the adviser is still to confirm the details.
  No till screen or server route calls `recordVoid` yet.
  [Detail](backlog/fiscal.md#owner-decision-2026-09-24-a-void-counts-on-the-day-it-is-made-not-the-day-of-the-sale)

- **One authorised edit of a protected test, plus its neighbours** (bundle of 4, size S, needs the owner). [Detail](backlog/fiscal.md#bundle-one-authorised-edit-of-a-protected-test-plus-its-neighbours)

- **Adviser confirmation: supplier invoice numbers by issue year.**
  [Detail](backlog/fiscal.md#adviser-confirmation-supplier-invoice-numbers-by-issue-year).

- **Reporting — the fiscal remainder (parked)** — left open by the modelo 303 work (#76, #91, #98, #1106).
  [Detail](backlog/fiscal.md#reporting--the-fiscal-remainder-parked)

- **A231/A948. Full invoices at the till** — table bill payments, per-bill unpaid departures and, since #2725, Counter bills paid through the shared Pay window issue F1. Direct `POST /api/pay`, closing a counter bill by transfer and zero-total counter bills still refuse it.
  **Next action:** complete physical paper/QR qualification, the asesor's manual-remedy confirmation and current business-invoice delivery qualification as separate work. The owner removed these as switch prerequisites on 2026-10-27.
  An unpaid departure, Print the bill or the close of the business day that issues the invoice of a presented bill loses the table name on it: `issueUnpaidInvoice` saves it only on an open bill (`apps/server/src/working-order-invoice.ts`), and neither `settleIssuedOwingNothing` nor the later collection sets it. A deferred-payment close (`closeBillDeferredTx`, `apps/server/src/deferred-close.ts`) now passes it to `settleIssuedOrder` (A275); a bill that leaves owing needs a decision on when to save it.
  [Issuance and remaining limits](backlog/fiscal.md#a231-full-invoices-at-the-till)

- **A554. Find a bill and Orders show the address an invoice was emailed to** — queued as
  INVOICE-EMAIL-SHOWN (lane I). Owner, 2026-11-24, picker: "Yes, in Find a bill and Orders (Recommended)".
  [Detail](backlog/fiscal.md#a554-find-a-bill-and-orders-show-the-address-an-invoice-was-emailed-to)

- **A556. A full invoice that later replaces a bill's simplified one would not be delivered through
  the bill.** Nothing issues an F3 today: no route calls `recordSubstitution`.
  [Detail](backlog/fiscal.md#a556-a-full-invoice-that-later-replaces-a-bills-simplified-one-would-not-be-delivered-through-the-bill)

- **W41s. Fiscal prevention and offline recovery.**
  Importing, matching or reconciling recovered history, and any missing-history remedy, stay out:
  the owner's answer to Q41 (owner, 2026-11-18, question 10 of the [19 November sheet](compliance/2026-11-19-adviser-meeting.md)) is to
  record what happened rather than rebuild lost invoices (the incident record below); the adviser is still to confirm the details. Signed witnesses and fencing (W41s-10b)
  were retired on 9 November 2026: A1342 (#2654) stops a returning old main box once a spare it
  vouched for has taken over. A box restored from backup keeps the old box's id, so nothing stops
  the old box after a restore; A1418 part 1, still a plan, adds a check for a venue of one box.
  Qualify live AEAT
  reconciliation, production TLS and a till payment through a booted restored server. Of Task 8's
  disputed production remedies, the corrective invoice (the replacement) is built to file as an R5
  "S" (owner's answers A–E, 2026-11-14) and offered on the case dialog for a simplified invoice refused for a future date; the others stay disabled
  pending Q35/Q38/Q40 or a case-specific owner decision. Once its original's
  correction is accepted, on any issuing chain, an administrator may release a held cancellation
  through a remedy, which only a test policy enables today (production's `ENABLED_REMEDIES` holds
  only `record-correction` and `replacement-invoice`, for rejected records only,
  `packages/fiscal-verifactu/src/record-remedy-routes.ts:32`).
  [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04).

- **An incident record the venue can show the tax office: hardware faults, a break-in, lost data.** Owner, 2026-11-18 (question 10 of the
  [19 November sheet](compliance/2026-11-19-adviser-meeting.md)): record every incident rather than rebuild lost invoices from
  AEAT's records; the adviser is still to confirm the details. Not designed.
  [Detail](backlog/fiscal.md#an-incident-record-the-venue-can-show-the-tax-office-hardware-faults-a-break-in-lost-data)

- **Allocated standby adoption still needs the primary's venue copy and fresh establishment
  authority.** Complete the copy and authenticated establishment path before presenting a successful fiscal
  join. The pending file alone supplies no live authority.
  [detail](backlog/fiscal.md#w41s-4-adoption-boundary-checkpoint-2026-10-14).

- **Settle the hold and the brake once** (bundle of 2, 2 important, size S, needs an answer from AEAT's developer channel). [Detail](backlog/fiscal.md#bundle-settle-the-hold-and-the-brake-once)

- **The reconcile sweep may raise a second "accepted with errors" warning.**
  [Detail](backlog/fiscal.md#the-reconcile-sweep-may-raise-a-second-accepted-with-errors-warning).

- **Loose ends left by C126 (cancelling an order whose invoice was issued credits it, #1030).**
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **Task 6 (#818) and C50 (#847): the ticket of a bill collected after a correction still shows the original invoice total.** **PARKED (owner,
  2026-09-29)** until the product can issue a corrective invoice. Left
  open by the table actions plan.
  [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)

- **A receipt printer can lose its reply after printing.**
  **Next action:** decide how an uncertain physical delivery should be recovered; request deduplication alone does not establish one physical print.
  [Detail](backlog/fiscal.md#uncertain-receipt-delivery)

- **A853. The box makes a company seal's private key itself** (decided out of A795, 2026-10-18).
  Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a853-the-box-makes-a-company-seals-private-key-itself)

- **VAT rates per product, eaten in or taken away (was: VAT at line add, M7v, A68).** Under the
  [design](superpowers/specs/2026-11-21-vat-rates-design.md), each product has its own dated
  takeaway rate and everything eaten here files at the one dine-in rate. Left: set menus with no VAT
  of their own and removing the old VAT classes (piece B), and scheduled and bulk rate changes
  (piece C). Drinks served
  without food may take 21%: unsettled, and the adviser will come back on it. [Detail](backlog/fiscal.md#vat-rates-per-product-eaten-in-or-taken-away-was-vat-at-line-add-m7v-a68)

- **Offer 2%, 5% and 7.5% taken away once modelo 303 can report them.** Spain's pick list for a
  takeaway rate stops at 0, 4, 10 and 21% because the modelo 303 download has no box for the
  others. [Detail](backlog/fiscal.md#offer-2-5-and-75-taken-away-once-modelo-303-can-report-them)

- **Correcting a paid invoice: dish counts, earlier refunds and cancelled dishes (left open by
  A802 slice 5b, #3108).** The correction window ticks whole dishes; an earlier ordinary refund does not
  count towards a correction; a refund of cancelled dishes does not yet file its corrective in the
  same step (A758 §3.8, owner Q43 e).
  [Detail](backlog/fiscal.md#correcting-a-paid-invoice-what-a802-left-open)

- **A report for the accountant: wrong VAT rates**
  (owner, D6 and D12, 2026-11-16; owner, 2026-11-18, question 5 of the
  [19 November sheet](compliance/2026-11-19-adviser-meeting.md); the adviser is still to confirm the details). A rate set too low or too high goes on a report the
  accountant acts on; later corrections of earlier periods, and what was given free, are on the VAT
  return screen's corrections workbook. Fiscal: the owner lands it. [Detail](backlog/fiscal.md#a-report-for-the-accountant-wrong-vat-rates)

- **Probe a replacement R5 "S", and an R4 "S", on AEAT's test service (go-live; watcher, 2026-11-14 18:22; the R4 "S", watcher, 2026-11-15 01:52).** Run
  before the first real R5 'S': a simplified invoice refused for a future date (`1112`), then a
  replacement R5 "S" naming it with rectified amounts 0.00 / 0.00, sent while the original's date is
  still in the future and again after it has passed; and an R4 "S" replacing a full invoice refused
  the same way, naming the same customer. It needs a new `live-aeat` mode in the
  `verifactu` repo, which needs the owner's approval, by A985's precedent. Left open by Q37-FIX.
  Turning on full-invoice replacement (`FULL_INVOICE_REPLACEMENT_ON`, A1407) waits for this probe.

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live filing.**
  The advisor is asked only to confirm (review item [R3](compliance/asesor-questions.md#the-shortened-list-2026-10-09)).
  **Non-blocking while pre-production; blocking before going live.**
  [Detail](backlog/fiscal.md#no-tax-0-is-an-open-fiscal-question-and-it-must-be-answered-before-the-first-live-filing)

- **Rename the `hour-*` names to minute names** — left by A947 slice 4a.
  Before go-live it needs no compatibility code: until then any installation may be reset (CLAUDE.md §3).
  [Detail](backlog/fiscal.md#rename-the-hour--names-to-minute-names).

- **Should `packages/fiscal-verifactu` have a mutation floor?**
  [Detail](backlog/fiscal.md#should-packagesfiscal-verifactu-have-a-mutation-floor).

### The setup wizard, onboarding and the demo venue

- **Stream the remaining recovery archive uploads.**
  The unused archive-preparation route and emergency handover buffer uploads within 256 MiB.
  [Detail](backlog/setup.md#stream-the-remaining-recovery-archive-uploads).

- **Qualify year-sized Cloud backups and revisit incremental copies with venue measurements.**
  Pair the box and Cloud release candidates on a year-sized backup and near-cap publication.
  In the paired rehearsal, verify a fresh signed upload after the storage primary stops.
  Measure the deployed verifier's resource use on the representative capture.
  Revisit continuous Cloud copies, content-named pieces and a read-only archive database after
  real venue measurements. The [time-ordered ID plan](superpowers/plans/2026-11-24-time-ordered-row-ids.md)
  covers the synthetic trading-day comparison.
  [Detail](backlog/setup.md#qualify-year-sized-cloud-backups-and-revisit-incremental-copies-with-venue-measurements).

- **A1186. The setup tour offers Waitron Cloud's level-2 trial (owner, 2026-10-29).**
  **Build remains open**; Cloud's qualified trial journey is prerequisite G1 in the plan.
  Stays in the backlog, in no lane, until Cloud's sign-up and trial pages and a real box-to-Cloud connection exist (owner, 2026-11-09).
  [Detail](backlog/setup.md#a1186-the-setup-tour-offers-waitron-clouds-level-2-trial-owner-2026-10-29).

- **A1089: setup and backup recovery must distinguish waiting from missing capability.** Separate absent callbacks/services and incompatible or refused retained artifacts from temporary work; offer a supported source, image or recovery choice and any required sign-in there.
  [Audit](backlog/self-service-refusals.md#setup-readiness).

- **A1089: an incomplete-join reset needs an outcome after a failed restart.** Add a supported way to retry or restart if the half-join remains.
  [Audit](backlog/self-service-refusals.md#setup-reset).

- **A1089: setup state refusals need a usable resume or recovery route.** Read A1042's S7l change first. Handle retained-operation mismatch and damaged setup without directing the owner to support; keep operation ownership and fiscal evidence. A1159 and A1161 list what still refuses. Start again (former A1158) and Recover from backup still have no warned way out when a damaged setup retains its installed box row, even without sales or fiscal records.
  A refusal at Provision still leaves the setup page stuck, because the recovery pack's grant is used up before the module's checks run (`packages/provisioning/src/first-setup-activation.ts:116-120`); since SETUP-STALE-CLOCK a clock refusal there needs a reboot, a server restart or a clock step after the series step, or a time service that does not answer.
  [Audit](backlog/self-service-refusals.md#setup-state).

- **A1159: some setup databases the box cannot read still refuse Start again.** A damaged one is
  deleted since A1131bc slice 2; one it may not open, one beside a journal, and a damaged `node.db`
  still refuse. Left open by A1099.
  [Audit](backlog/self-service-refusals.md#a1159-some-setup-databases-the-box-cannot-read-still-refuse-start-again).

- **A1161: with the database present, a public record or documents file still dead-ends Start
  again**, damaged or intact, and since A1206 so does the summary. Left
  open by A1099; the owner asked for a safe self-service way out of damaged evidence (2026-10-25), not designed.
  [Audit](backlog/self-service-refusals.md#a1161-with-the-database-present-a-public-record-or-documents-file-still-dead-ends-start-again).

_Formerly A2 and B1._ Detail: [backlog/setup.md](backlog/setup.md).

- **Loose ends left by A496 (moving to a new tax ID).**
  [Detail](backlog/setup.md#loose-ends-left-by-a496-moving-to-a-new-tax-id)

- **`restoreFromArtifact` has no production caller.** Only tests call it since A1131bc slice 4;
  decide whether they should place archives through `runStagedRestore`, then delete it.
  [Detail](backlog/setup.md#restorefromartifact-has-no-production-caller)
- **A start on a full ext4 disk is not tried.** The spare file's room is measured on HFS+ and
  Linux tmpfs; the box's ext4 is measured only for what it allocates. Left open by A1127.
  [Detail](backlog/setup.md#a-start-on-a-full-ext4-disk-is-not-tried)

- **A237. Nothing guards the hint-or-"?" rule across screens (owner 2026-10-03)** — OPEN.

- **Starter courses for Italy.** When its country pack is built, add the four courses and settle
  their firing defaults. [Detail](backlog/setup.md#starter-courses-for-italy)

- **A guided tutorial for Demo and Preparation (A250, owner 2026-10-03)** — OPEN, partly designed,
  not to be built yet (owner: "we just mustn't forget it"); needs a spec before queueing.
  [Detail](backlog/setup.md#a-guided-tutorial-for-demo-and-preparation-a250-owner-2026-10-03)

### Menus and the menu

- **Loose ends left by A322 (#1372, an included menu can show its sections directly).** Folder photos
  and shortcut placement remain open.
  [Detail](backlog/menu.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open)

- **A very long number is cut off in an extras list form.** [Detail](backlog/menu.md#what-1151-left-open-2026-10-03)

- **A1523. A cover charge, and dearer seats on the terrace (owner, 2026-11-14).** Not supported
  today. A cover charge applies only to orders eaten in (A1522's setting). The only way to charge
  more on the terrace today is to make it a department of its own with its own menu. Not designed.

- **A1517. Accepted allergen changes before go-live (owner, 2026-11-11): go-live.** The owner accepted
  the recommendations. The remaining guest-menu checks are tracked under A670.
  The [cleared new-selection plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a1517-2-allergen-choices.md) leaves option-list labels unfiltered because they carry no allergen data.
  [Proposal](superpowers/specs/2026-11-11-a1517-allergen-proposal.md) · [Detail](backlog/menu.md#a1517-allergen-points-to-revisit-before-go-live)

- **Menu prices' narrow-layout CI failure still needs a cause (A613).**
  [Detail](backlog/ci.md#menu-prices-narrow-layout-ci-failure-still-needs-a-cause-a613)

- **Tabs selected visible** (bundle of 1, size S, needs the owner). [Detail](backlog/menu.md#bundle-tabs-selected-visible)

- **The Products list: dishes first, a List and a Tree, and a switch for Available (owner,
  2026-11-24).** Approved design, in seven pieces, with the faults a critique found.
  [Design](superpowers/specs/2026-11-24-products-list-redesign-design.md)

- **A670 — the customer menu, online and printed (owner, 2026-11-24).** Each menu gets a Customer menu
  tab with Online and Print, named styles, and a customer page the box serves through Cloud; today's
  Guest menu preview and the hosted copy go.
  [Design](superpowers/specs/2026-11-24-customer-menu-design.md) ·
  [Detail](backlog/menu.md#a670--guest-menu-sharing-and-fixed-a4-presets)
- **Allergens and diets are published with the menu (owner, 2026-11-24), replacing A1150.** Piece 2 of
  the same design, section 8; it stands alone.

- **Smaller things #379 surfaced and did not take.** Separating product and modifier rules.
  [Detail](backlog/menu.md#smaller-things-379-surfaced-and-did-not-take)

- **Translation report excludes image names (C122, #1006).** The media module's
  `contentTranslations` seat supplies only a kind and an id. Showing a name or editor link needs
  a separate seat design that respects module boundaries; no change is queued.

- **The media library still reads every matching image for search and name sorting, inside the venue
  write lock** — further optimisation waits for a material measured sale delay; the watcher
  chose no split after the 2,000-image Mac probe (2026-11-16).
  [Detail](backlog/menu.md#the-media-library-still-reads-every-matching-image-for-search-and-name-sorting-inside-the-venue-write-lock)

- **Menu home preview rendering** (size M). [Detail](backlog/menu.md#menu-home-preview-rendering)

- **Translate all: review followups** (bundle of 1, size M). [Detail](backlog/menu.md#bundle-translate-all-followups)

- **Translate all: shared collect-page test vectors.** Nothing compares the fake Cloud's paging
  (`apps/server/test/translation-cloud-fixture.ts`) with Cloud's own; vectors Cloud generates and
  both sides check would catch drift in CI. A contract change for Cloud's side.
  [Detail](backlog/menu.md#translate-all-shared-collect-page-test-vectors)

- **Product folders, menus that include menus, and prep station routing: partly built (design
  approved 2026-09-30).**
  [Detail](backlog/menu.md#product-folders-menus-that-include-menus-and-prep-station-routing-partly-built-design-approved-2026-09-30)

- **Sales classification and the menus plan — what they left open.** `Product.categoryId` and
  `primaryCategoryId` always hold the same value.
  Include demo and readiness sales when finishing classification.
  [Detail](backlog/menu.md#sales-classification-and-the-menus-plan--what-they-left-open)

- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.**
  [Detail](backlog/menu.md#category-authoring-serialises-across-the-whole-database-and-nobody-has-measured-what-that-costs)

- **Extras list forms** (remaining deliberate limits). [Detail](backlog/menu.md#bundle-extras-list-forms)

- **A821f. A product sold by a measure with no scale (ml) asks its amount** — queued as MEASURE-AMOUNT
  (lane E). Owner, 2026-11-24: "yes type the amount, or use the +- … but that should be a single value, not
  a line per ml". [Detail](backlog/menu.md#a-dish-in-a-measure-unit-is-still-rung-up-one-unit-per-tap)

- **The combined end-to-end journey has not been walked**
  [Detail](backlog/menu.md#the-combined-end-to-end-journey-has-not-been-walked)

- **The picker collapses on `focusout` alone** (`#finishEditing`). If the editor is reported
  snapping shut mid-selection, make the collapse depend on `relatedTarget`.


### Service periods, opening hours and departments

- **A1512. Send the venue's opening hours to Google (owner, 2026-11-11; was SP19).** Wanted. The
  hours and closures kept in Waitron update the venue's Google Business Profile, so Google Maps never
  shows a closed venue as open. Needs a design. Not started.

- **A1568. Last orders per prep station** (owner, 24 November). Lunch keeps its hours while each
  station stops taking its orders before or after the end. Settings, the server’s ordering rule,
  the till’s ended menus and dish warnings, and the demo remain.
  [Design](superpowers/specs/2026-11-24-last-orders-per-station-design.md)

- **Try the Calendar's long press on real Android and iOS phones (A720).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a720)


- **`isLocalDate` reads years 0 to 99 as 1900 to 1999**
  [Detail](backlog/service-periods.md#islocaldate-reads-years-0-to-99-as-1900-to-1999)

- **Split an order's recorded service mode into two facts (owner, 2026-10-09) — future work.**
  [Detail](backlog/service-periods.md#split-an-orders-recorded-service-mode-into-two-facts)

- **Smaller notes from the Hours reviews** — left open by the reviews of A261 step 5 (Hours, #1298):
  repeated-midnight clock choices still need checking.
  [Detail](backlog/service-periods.md#smaller-notes-from-the-hours-reviews)

### The kitchen and preparation

_Formerly the kitchen entries in the opening part of the old Track A (before A1), and kitchen entries elsewhere; part of A9._ Detail: [backlog/kitchen.md](backlog/kitchen.md).

- **Held paper followups** (1 entry, size M). [Detail](backlog/kitchen.md#bundle-held-paper-followups)

- **Loose ends left by service Task 5 (#750): printer policy, dish units, group records,
  and screen refresh.**
  [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)

- **KDS corrections deferred from #191** — owner, 2026-09-01.
  [Detail](backlog/kitchen.md#kds-corrections-deferred-from-191)

- **Mark a new dish as urgent** — owner, 2026-09-27.
  [Detail](backlog/kitchen.md#mark-a-new-dish-as-urgent)

- **Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it).** —
  left open by the menus plan.
  [Detail](backlog/kitchen.md#changing-sent-lines-and-the-kitchen-screen-task-7c-710-and-the-kitchen-fixes-after-it)

### The till, devices and table service

- **A Make now instruction can disappear or come back while the till checks its device again.**
  [Detail](backlog/till.md#a-make-now-instruction-can-disappear-or-come-back-while-the-till-checks-its-device-again)

- **Let staff answer a required list on a withdrawn dish.** [Detail](backlog/till.md#options-on-a-withdrawn-dish)

- **Check the till above a tablet's own keyboard again (left open by A1563, typing on the till
  with a keyboard, #3986).** On 21 November the owner's Oppo phone passed, and so did the Pixel
  tablet in portrait. In landscape the tablet kept the page full height under its keyboard, so a
  window's buttons sat under it. Windows now fit in the part of the page left visible (#3986), and
  on 22 November the tablet showed it for the station note and the table name. The Counter's
  product search and Find a bill's search were left at or under the keyboard's edge; a field on a
  page now moves to the top of the visible part, with room below the page to scroll into. That was
  checked only by setting the keyboard's measurements by hand in a desktop browser, which draws no
  keyboard. The owner opens the bill name window, the Counter's search and Find a bill's search on
  the tablet in landscape. Safari is untested: there is no Apple device.

- **A1569. The till's sold-out window needs a design with the owner (owner, 2026-11-24): on hold until
  the device screens are reviewed.** Nothing on
  a tile shows that holding it opens the window, and the till says "sold out" where the dashboard
  says "unavailable". [Detail](backlog/till.md#a1569-the-tills-sold-out-window-needs-a-design-with-the-owner)

- **Small till and floor wording fixes** (bundle of 1, size S). [Detail](backlog/till.md#bundle-small-till-and-floor-wording-fixes)

- **SETTLED-SMALL. Small answers the owner gave that are not built yet** — queued (lane I): a supervisor's
  read-only station views (A1079, A506-12), "started" wins (A1080), the station's name in refusals (A1081),
  "Take the rest", extras keep "made here" (A692), variants in the extras form, one word per meaning
  (A957, A1011). [Detail](backlog/till.md#settled-small-small-answers-the-owner-gave-that-are-not-built-yet)

- **A1421. The Downstairs map drawn tiny at phone width.** Seen once, not investigated.
  [Detail](backlog/till.md#a1421-the-downstairs-map-drawn-tiny-at-phone-width)

- **The till's top bar: loose ends (A395, #1435; A425).** Its scrolling strip is kept as agreed (closed
  2026-11-24). [Detail](backlog/till.md#the-tills-top-bar-is-one-row-at-every-width-a395-1435-left-open)


- **A803. Bills and tables: one portion per order line, one bill switcher, one picker (owner,
  2026-10-18).** Owner-approved design; A773-1 has landed. Slice 4c, Split a table through the same
  picker, has landed; it leaves open A1359. Remaining: pre-bills through A446, not scheduled for
  the foreseeable future (owner, 2026-11-17).
  [Detail](backlog/till.md#a803-bills-and-tables-one-portion-per-order-line-one-bill-switcher-one-picker)


- **Table screen panels that do not fit** (bundle of 1, size S). Holds A1565. [Detail](backlog/till.md#bundle-table-screen-panels-that-do-not-fit)

- **Every screen and slip names an order by where it is now (A678, A1235, A1032, A1031)** — queued as
  MOVED-ORDER-PLACE (lane E). Owner, 2026-11-24, picker: "Yes, where it is now (Recommended)".
  [Detail](backlog/till.md#bundle-one-answer-to-where-is-this-order)

- **A1261. A full invoice for a bill already paid, from the table's ⋮ (left open by A803 slice 3,
  Owner question 2, #2360).** Correct invoice (A802) does not issue a full invoice; offer one
  from the ⋮ for a paid bill once something does.
  [Detail](backlog/till.md#a1261-a-full-invoice-for-a-bill-already-paid-from-the-tables-)

- **Other till sentences still send the person to somebody else, against the refusal rule (left
  open by A1382, #3605 and #3604; fiscal and invoice wording remains).** Listed by code in the detail.
  [Detail](backlog/till.md#other-till-sentences-still-send-the-person-to-somebody-else-against-the-refusal-rule)

- **An action on a grouped row covers every portion (A1193, A1194)** — queued as GROUPED-ROW (lane F).
  Owner, 2026-11-24: "firing that line now should send all 3. the kitchen has the choice of how they want
  to receive them: 3 lines or 1 line".
  [Detail](backlog/till.md#a1193-and-a1194-an-action-on-a-grouped-row-covers-every-portion)


- **A937. Measure the owner's real floor plan once it is drawn (left open by A757 slice 5).** Slice
  5's size check ran on Santet's invented grid, where Terrace's tables show names but no cue; re-run
  it on the owner's floor. [Detail](backlog/till.md#a937-measure-the-owners-real-floor-plan-once-it-is-drawn)

- **A1033. A full invoice's later copies change their guests line when a bill moves to the counter
  (left open by A758-7).** A simplified receipt keeps the count stored at payment.
  [Detail](backlog/till.md#a1033-a-full-invoices-later-copies-change-their-guests-line-when-a-bill-moves-to-the-counter-left-open-by-a758-7)

- **An element inside a shadow root attached after a drag starts keeps its own cursor rule during
  that drag** — left open by A642.
  [Detail](backlog/till.md#an-element-inside-a-shadow-root-attached-after-a-drag-starts-keeps-its-own-cursor-rule-during-that-drag)

- **A1564. Custom item on the Counter (A738 residual; owner, 2026-11-21; two of four pull requests to come).**
  A dashed + Custom item tile for the rare thing not on the menu: typed name and price, the
  takeaway VAT rate asked only on a takeaway order, a kitchen station or none. Each line sits on
  a hidden product per takeaway rate, or on one whose rate nobody chose; a new permission,
  `order.custom_item`, or a supervisor's PIN.
  Nobody can sell one yet: what exists is the hidden products (`customItemProduct`, which nothing calls),
  the permission, which nothing checks, and the "Custom items" row of the category report. To come: the
  server's order lines (Tasks 4a to 7b) and the till (Tasks 8 to 10c). The watcher cleared Tasks 4a to 7a
  to build. The owner answered Decision 2 on 2026-11-24: a bill keeps its eaten-here or takeaway way when
  it moves or is handed over. Task 7c, a small pull request of its own before the server's, made that
  true: an unsent bill no longer takes the new department's way, or its VAT.
  Design `docs/superpowers/specs/2026-11-21-counter-custom-item-design.md`, plan
  `docs/superpowers/plans/2026-11-21-counter-custom-item.md`.
  [Detail](backlog/till.md#custom-item-on-the-counter-a738-residual)

_Formerly A4; part of A9._ Detail: [backlog/till.md](backlog/till.md).

- **Loose ends left by the comments sweep (#613–#623).** Found while pruning comments.
  - The table screen's redundant exit configuration was not audited (#616).
    [Detail](backlog/till.md#the-table-screens-redundant-exit-configuration-was-not-audited)

- **Cash handed back for a voided cash sale is recorded nowhere** — OPEN (found 2026-09-24 by #605).
  A void writes no payment or refund row, so if staff give a customer cash back, the void's day
  shows a drawer shortfall at cash-up. **Owner decision 2026-09-25:** keep it here and decide it
  when the till's void screen is designed.
  [Detail](backlog/till.md#cash-handed-back-for-a-voided-cash-sale-is-recorded-nowhere)

- **For the owner's redesign of the table screens and review of the device screens** (bundle of 17,
  nothing to build before them). Holds A1211, A893, A936, A856, A859, A561, A562, A1101, A550, A857, A672,
  A1333, A470, A1107, A1108, A1359, A1290, A1265.
  [Detail](backlog/till.md#bundle-for-the-owners-redesign-of-the-table-screens-and-review-of-the-device-screens)

- **A474 — today's floor changes on the till: follow-ups (2026-10-11).** The map's drag works out
  its target the slow way, and smaller gaps. Left open by A429 slice 4 (#1526).
  [Detail](backlog/till.md#a474--todays-floor-changes-on-the-till-follow-ups)


- **Other till surfaces have not been checked against the forms rule.** The payment and weighing
  steps, the dish options picker and the supervisor override dialog hold their buttons before any
  press; whether a number pad or a choice picker counts as a form is open. Left open by C47.
  [Detail](backlog/till.md#other-till-surfaces-have-not-been-checked-against-the-forms-rule)

- **Guest-facing QR, online ordering, delivery, online booking** (bundle of 4, size L, waits for another entry). Holds A508, A509, A1012, A1013. [Detail](backlog/till.md#bundle-guest-facing-qr-online-ordering-delivery-online-booking)

- **A1513. Take orders from the delivery apps: Glovo, Uber Eats, Just Eat (owner, 2026-11-11).**
  After go-live, not at it. Today staff would type each app order into the till by hand. Needs a
  design, including whether to connect each app or one service that gathers them all, and sending
  them the menu (owner, 2026-11-24). Not started. A delivery-app order is always taken away.

- **A1514. Share bookings with TheFork and Reserve with Google (owner, 2026-11-11).** Later: Waitron's
  own booking system, including online booking (A1013), works first. Without it, a venue taking
  bookings in both places can double-book a table. Not started.

- **One measuring pass over the till at 390 and 1024** (1 entry remains for the owner's floor-map redesign). [Detail](backlog/till.md#bundle-one-measuring-pass-over-the-till-at-390-and-1024)

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group).**
  - Each new group Ready command moves the party's revision, so a waiter's open table screen meets
    `party.out_of_date` after it and reads again.

- **Loose ends left by service Task 11 (#916, cancellations, comps and discounts; B11a–B11g).**
  The adjustment history records who approved, but not whether the bill's comp limit or the refund rule,
  rather than the reason, is why.
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **Loose ends left by service Task 16 (#981, counter handover).**
  Till-profile defaults.
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **Loose ends left by service Task 17 (#991, a bill left unpaid).**
  A dish the kitchen is not making blocks the departure; the table screen reads a credited
  presented bill at its full amount; a presented bill keeps its old label when it is invoiced.
  [Detail](backlog/till.md#task-17-991-a-bill-left-unpaid)

- **Add a device: loose ends from A268** (bundle of 1, size S). [Detail](backlog/till.md#bundle-add-a-device-loose-ends-from-a268)

- **Loose ends left by the table actions plan (Task 8, #869; C77/C86; C84).**
  [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)

- **Later: optional seat/guest item assignment (owner, 2026-09-20).** Include shared items when this
  is designed. For now, orders remain at table/tab level and staff select items manually when
  splitting bills; seat assignment is not a prerequisite for the service workflow.

- **Later: staff-to-table assignments (owner, 2026-09-20).** Design assigning responsibility for
  tables to staff, including handover and how assignments appear on the floor dashboard. The current
  workflow discussion assumes no assignments; they are not a prerequisite for the dashboard.

- **The three displays walked end to end** — [ui-review.md](ui-review.md)'s areas, at the real box,
  as part of walking the box with the printers; with the owner present, after 2 November (owner,
  2026-10-17).

- **Qualify printer identity at enrolment.** The device enrolment design's separate printer track remains. [Detail](backlog/till.md#bundle-printer-identity-at-enrolment)

- **Waiter cash floats (A240)** (size L, needs a spec). [Detail](backlog/till.md#waiter-cash-floats-a240--open-needs-a-spec-before-queueing-owner-2026-10-03)

- **Loose ends left by W97 (#1311).**
  - A disabled device's profile approvals come back when a join enables it again (unchecked
    whether that is wanted).
  - The profile editor also reads people, so it needs `person.manage` beside
    `venue.configure`; no role holds only the latter today.
    [Detail](backlog/till.md#the-profile-editor-reads-people-and-the-venues-departments-and-zones)


- **Uploaded font files for themes (owner, 2026-10-20, A841 Q7 B) — after A841.** A theme's Typeface
  may also be a font file the venue uploads, so every screen draws the bar's own face.
  [Detail](backlog/till.md#uploaded-font-files-for-themes-owner-2026-10-20-a841-q7-b--after-a841)

- **The till's menu reads (Task 7, #719).** — left open by the menus plan. Every menu poll waits
  its turn in the write queue.
  [Detail](backlog/till.md#the-tills-menu-reads-task-7-719)

- **The till's home page (Task 9, #729).** — left open by the menus plan. Every menu read from an
  enrolled device also reads the device and the till's setup.
  [Detail](backlog/till.md#the-tills-home-page-task-9-729)

### Printers, the print agent and receipts

_Formerly A3, A8 and B6; part of A9._ Detail: [backlog/printers.md](backlog/printers.md).

- **A print agent somewhere other than the box** (bundle of 3, size L, waits for another entry). Holds A1203, A1204, A1175. [Detail](backlog/printers.md#bundle-a-print-agent-somewhere-other-than-the-box)

- **One session at the real box: printers, paper, tax QR, the drawer** (size M, needs the real hardware and inbox). Holds the remaining A739, A773 and A552 checks. [Detail](backlog/printers.md#bundle-one-session-at-the-real-box-printers-paper-tax-qr-the-drawer)

- **Measure one-job print pulls on the box.** Physical throughput, authentication and large retained queues remain unmeasured. [Detail](backlog/printers.md#measure-one-job-print-pulls-on-the-box)

- **Waitron carries two QR encoders; consolidate on `qrcode-generator`** — Small.
  [Detail](backlog/printers.md#waitron-carries-two-qr-encoders-consolidate-on-qrcode-generator)

- **The virtual PDF printer.** Print-payload retention is handled by daily housekeeping; virtual PDF output remains.
  [Detail](backlog/printers.md#the-virtual-pdf-printer)

- **Reprint kitchen tickets and other printouts laid out again for any printer (left open by A405
  point 4, #2678)** — needs a `print_jobs` column.
  [Detail](backlog/printers.md#reprint-kitchen-tickets-and-other-printouts-laid-out-again-for-any-printer)

- **A4 receipt copies.** When adding A4 receipt printing, have the copy-audit writer require a
  receipt-page job. Test that it accepts a receipt page and refuses an A4 invoice page.

- **A1201. A receipt's extra shows its own count under a grouped dish** — queued as RECEIPT-EXTRA-COUNT
  (lane I). Owner, 2026-11-24, picker: "Yes, show its total (Recommended)"; the paper is shown before landing.
  [Detail](backlog/printers.md#a1201-a-receipts-extra-shows-its-own-count-under-a-grouped-dish)

- **A full invoice can print `Descuento 100%` on a row that still has a charge.** On a takeaway
  bill, make the 10% olives on a 21% pizza free and issue a full invoice. The pizza and olives can
  each say `Descuento 100%` while both still carry filed amounts after sharing the price paid (A445).

### Payments and card readers

_Formerly A6, and the old Track C's payments items; part of A9._ Detail: [backlog/payments.md](backlog/payments.md).
See [device equipment defaults](backlog/till.md#device-equipment-defaults-w100-1332-owner-kept-every-default-2026-10-07) for how a default reader reaches a till.

- **A742 — the guest types what they pay, and a tip (owner, 2026-10-15; on the backlog, NOT to be
  queued yet).** A flow where staff hand the device to the customer, who enters how much they want
  to pay of the bill and optionally adds a tip, then hands it back or pays on the reader. Builds on
  A739's payment window (An amount) and the bill payments design's tips. Not designed.


- **Stripe adapter upkeep** (bundle of 5, size S). [Detail](backlog/payments.md#bundle-stripe-adapter-upkeep)

- **A846. A held card payment is Refunded or Put on a bill, never Kept** — queued as HELD-KEPT (lane F).
  Owner, 2026-11-24: "yes" to removing "Kept: the money was owed"; its reminder follows the venue's business
  day. [Detail](backlog/payments.md#a846-a-held-card-payment-is-refunded-or-put-on-a-bill)

- **The SumUp Solo experiments.** Physical decline behavior, the statement/fee check and remaining
  connection probes are open. The reported decimal-`0.40` probe refunded the full payment, but its
  request bytes were not saved and the cause is unknown.
  [Sandbox checks and the owner’s 15-minute settlement script](research/2026-11-15-a949-sandbox-and-settlement-check.md)
  record the successful €10 Virtual A control, two virtual decline scenarios and a separate
  successful €10 Virtual B payment on 16 November. The €11 late result needed manager confirmation;
  €42.51 used generic decline wording. The daily SumUp audit matched the owner's 17 November
  €1.40 paired-Solo charge. The 19 November chip-and-PIN check matched by reference and amount.
  A replay of the saved standalone Solo sample matched the €1.50 pair with the 30-minute
  window and kept the separate €1.40 entry unmatched. The owner closed these hands-on checks on
  20 November. Signature was not tested because no card was available.
  Idle SumUp battery refresh timing is unqualified. Check missing battery percentages on the
  reader itself. No further paid request unattended.
  [Detail](backlog/payments.md#the-sumup-solo-experiments)

- **The deli's outage card machine.** Buy the standalone machine and
  replace estimated prices with real quotes.
  [Detail](backlog/payments.md#the-delis-outage-card-machine)

- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race).

- **The SumUp reconciler** — other-provider and cash-only qualification. The November
  results now include cross-account affiliate acceptance, pending/paid references, REFUNDED events
  and unpaid cancellation. The first recovery slice supplies Waitron's partner key and records
  identified refunds.
  Backup payment entry now records optional source, machine and operation details, including
  Other card machine on a counter with a configured reader. The day report and accountant workbook
  carry those details, current payment state and successful-refund totals.
  [Detail](backlog/payments.md#the-sumup-reconciler)

- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.

- **Tap to pay restore** (bundle of 1, size M, needs the owner). [Detail](backlog/payments.md#bundle-tap-to-pay-restore)

- **A793 — tips: who a tip belongs to, how it is shared out, and what payroll gets** — NOT
  APPROVED: the owner (2026-10-18, on Q38): "Leave this for now. Back to the backlog. It needs a
  bigger brainstorm." Next: that brainstorm with the owner, before any build or further question.
  [Detail](backlog/payments.md#a793--tips-who-a-tip-belongs-to-how-it-is-shared-out-and-what-payroll-gets)

### Users, sign-in and the dashboard shell

- **A1089: account-access recovery needs an authenticated decision when no offered sign-in works.**
  The passkey refusal offers retry, password entry and an emailed password reset. These do not
  reactivate a disabled account or replace unavailable email delivery. Design a recovery choice
  that offers any required administrator sign-in at the refusal, preserves account privacy and
  explains its effect before changing access.
  [Correction](backlog/self-service-refusals.md#sign-in).

- **A1437. Dashboard sign-in and SMS through Cloud — email/browser checks, enrolment and SMS.**
  Backups, recovery material, exports, people, your own sign-in, connections, handover and fiscal/box
  changes use the fifteen-minute session window. Handover requires a confirmation without a recovery
  code and an account with a password for the spare’s sign-in. The [ask-again plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-09-a1437-1-dashboard-reproof.md)
  retains current authenticator codes for own-account changes. The spare’s handover signs in with
  credentials sent in the request. Approving a box join needs a signed-in session with `node.manage`
  and a fresh sign-in. A Google-only account needs a password from password reset
  to open the window. Google proof and the later sign-in steps remain in the
  [design](superpowers/specs/2026-11-09-a1437-dashboard-sign-in-rules-design.md).

- **A venue without Cloud gets no dashboard email codes, texts or Google sign-in (left by A1437).**
  The owner, 2026-11-09: require a Cloud login for now; supporting a venue without one "shouldn't be
  forgotten". Low priority.

Detail: [backlog/dashboard.md](backlog/dashboard.md).

- **Form implementation leftovers:** eventual summary retirement. [Detail](backlog/dashboard.md#bundle-form-implementation-leftovers)


- **Wt dialog lifecycle** (covered-dialog reinsertion and the department and zone wrappers). [Detail](backlog/dashboard.md#bundle-wt-dialog-lifecycle)

- **One session with real phones and password managers** (bundle of 13, 3 go-live, 7 important, size M, needs the real hardware; includes profile-name updates in password managers and field-focus verification). [Detail](backlog/dashboard.md#bundle-one-session-with-real-phones-and-password-managers)

- **What C38 left as it was (a generated display name is the first given name and first surname,
  #827, owner decision 2026-09-28).**
  [Detail](backlog/dashboard.md#what-c38-left-as-it-was-a-generated-display-name-is-the-first-given-name-and-first-surname-827-owner-decision-2026-09-28)

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)** — remaining PIN-slot saturation, form focus and reset timing.
  [Detail](backlog/dashboard.md#every-login-failure-is-one-answer-c95-930-owner-decision-2026-09-30)

- **Shared database-backed table paging.** Find a bill retains its existing request state until
  its own adoption.
  [Detail](backlog/dashboard.md#shared-database-backed-table-paging-search-and-sorting).
  [Print Queue measurement and decision](backlog/dashboard.md#print-queue-keeps-its-current-read).

- **Other browser check** (bundle of 5, size S). [Detail](backlog/dashboard.md#bundle-other-browser-check)

### Interface languages

_Formerly entries spread across the old sections, C125 among them; part of A9._ Detail: [backlog/languages.md](backlog/languages.md).

- **Native speaker review** (bundle of 3, size S, needs a third party). [Detail](backlog/languages.md#bundle-native-speaker-review)

- **Regional languages** (bundle of 2, size L, needs the owner). C125, the staff screens in every
  official language, is off hold (owner, 2026-11-08). Extend the setup working-language choices and
  starter translations beyond English and Spanish here. [Detail](backlog/languages.md#bundle-regional-languages)

### Alerts, logging and diagnostics

_Formerly A5, and the logging part of A9._ Detail: [backlog/alerts.md](backlog/alerts.md).

- **A982. Logging Slice 2 — one-touch bug report.** Dashboard, setup and till browser-only preview/download
  are implemented by the [download-first plan](superpowers/plans/2026-11-08-a982-client-only-report-first.md).
  Richer trail privacy and stored capture with manager read/download remain;
  stored capture needs its own plan. Cloud forwarding and automatic crash/freeze reporting are separate.
  [Detail](backlog/alerts.md#logging-diagnostics--one-touch-bug-report-a9-slice-1-landed-192).

### Working time and staff

_Formerly A10; part of A9._ Detail: [backlog/workforce.md](backlog/workforce.md).


- **Wages / labour cost (SP16).** Gated on the labour advisor; not fiscal.
  [Detail](backlog/workforce.md#wages--labour-cost-sp16).

- **Inspector remote access to working-time records.**
  [Detail](backlog/workforce.md#inspector-access-to-working-time-records).

- **Have the labour advisor check working-time exports before go-live.**
  [Detail](backlog/workforce.md#advisor-review-of-the-working-time-export).

- **Payroll export waits for the gestoría's import format.**
  [Detail](backlog/workforce.md#payroll-export-and-unused-scheduling-tables).

- **MONTH-CLOSE. A month's hours close by themselves 3 working days after it ends, adjustable** — queued
  (lane I). Owner, 2026-11-24: "3 working days of grace, adjustable". The bundle also keeps the rule a
  cadence change needs after a close. [Detail](backlog/workforce.md#bundle-closing-a-months-hours-then-its-cadence-rule)

- **A586. Each person's contract terms, from ready-made rule sets that warn and never refuse
  (owner, 2026-10-22).** Waitron does not follow or enforce each country's or region's law.
  After A585.
  [Detail](backlog/workforce.md#a586-each-persons-contract-terms).

- **A587. Availability and personal preferences** (owner, 2026-10-22). After A586.
  [Detail](backlog/workforce.md#a587-availability-and-personal-preferences)

- **A588. A solver drafts the rota, as a paid Waitron Cloud feature (owner, 2026-10-22)**. After A587.
  [Detail](backlog/workforce.md#a588-a-solver-drafts-the-rota-as-a-paid-waitron-cloud-feature-owner-2026-10-22).

### Purchasing, recipes, stock and reports

- **Qualify the accountant workbook with a real accountant's import trial** before claiming
  support for a named accounting program. The generic two-sheet period download is available from
  **Sales & takings**; [recorded-data limits](superpowers/specs/2026-11-11-a1511-accountant-export-proposal.md)
  remain, including editable purchases and no automatic accounting sync.

- **One design for supplier invoices and credit notes** (bundle of 2, 2 important, size M, needs the owner). Holds A1326. [Detail](backlog/back-office.md#bundle-one-design-for-supplier-invoices-and-credit-notes)

### The box: backups, upgrades and recovery

The owner accepts the [quiet-box backup read limits](backlog/box.md#quiet-box-backup-read-limits) to reduce bucket requests.

- **A1323. One master key for the venue (owner, 2026-11-04; designed with the owner 2026-11-21 and 2026-11-23; every setup kind now makes the master key, records it in venue.db's `master_keys` table and shows it at setup's last step and on the first page of the recovery pack, and the Backups card can make a new one; restore and the invoice identity conflict switch are authorised by it, and backups are not yet encrypted with keys calculated from it).**
  The owner keeps one key, printed in the recovery pack, in place of the backup key, the server key, the Cloud emergency code and the disk key; the box keeps only a check value and numbered backup keys calculated from it. The emergency start in Cloud needs the master key typed in, and the pack no longer holds the storage password.
  Build it beside A1187 and A1188, which change the same restore steps. It changes the fiscal authority check, so the owner lands it.
  [Detail](backlog/box.md#a1323-one-master-key-for-the-venue)

- **The Backups card's receipts and looks** (bundle of 2, size S). [Detail](backlog/box.md#bundle-what-pack-part-1s-reviews-left)

- **A1089: authenticated server-certificate recovery is missing from the public connection page.**
  [Detail](backlog/box.md#authenticated-server-certificate-recovery)

- **A1089: diagnose and correct conflicting backup keys in the app.**
  Add authenticated inspection and correction with a safe Stop. Keep both key records when
  the effective key cannot be confirmed. Qualify which key opens an existing backup separately
  from accepting a later submission.
  [Correction](backlog/self-service-refusals.md#backup-key)

- **A1089: a repeated restored-box first-start failure needs a specific remedy.** Keep the existing restart attempt and identify a persistent completion refusal before suggesting another action.
  [Audit](backlog/self-service-refusals.md#restore-start).

- **A1089: exhausted cleanup still needs a supported disk-recovery workflow.** Box status explains the backup-retention choice, its lack of immediate space recovery and leaving without changes. Provide an authenticated recovery choice when no reclaimable files remain and a new backup cannot fit; preserve database files, keys and saved backups.
  [Audit](backlog/self-service-refusals.md#backup-preparation).

- **A1089: a failed sealed-state refresh for an unrecognised cause needs a correction beyond a restart.** The alert names the cause (A1089 B2); missing own files now says it is a fault, and the owner's answer of 2026-11-11 plans no route for it. Do not promise current recovery keys before success.
  [Audit](backlog/self-service-refusals.md#backup-state).

- **A1089: bucket-copy host-configuration failures need guided diagnosis.** The settings refusal explains Change bucket, Test, Save and turn on, and Cancel. A configuration failure outside those fields still needs authenticated diagnosis and an applicable correction; preserve recovery keys and existing copies.
  [Remaining workflow](backlog/self-service-refusals.md#backup-stream).

- **A1089: a refused bucket stream needs ownership choices, and a stopped one reason-specific guidance.** Start the copy again (A1089 B1) restarts a stopped copy with its saved settings. Distinguish an unavailable process from a conflicting writer; do not suggest resuming an unauthorised primary.
  [Audit](backlog/self-service-refusals.md#backup-stream).

- **A1089: unusable archive settings still have no repair beyond choosing them again.**
  Explaining or reconciling key numbers, restoring an old credentials key and rewriting the record
  remain open; left open by A1089's settings-evidence panel (#2244).
  [Detail](backlog/self-service-refusals.md#backup-settings)

- **Public TLS repair refuses linked layouts.** Healthy linked `tls/` folders still serve HTTPS,
  but a damaged linked folder or managed file cannot be repaired through the public guide. The
  public page offers retry, Check again and Stop; repairing a damaged linked layout remains open.
  [Detail](backlog/box.md#public-tls-repair-refuses-linked-layouts)

- **Full disk: the till read that fails, and the words** (the strip's tint, and DISK-FULL-SCREEN, queued in lane I: a red window over the whole screen; owner, 2026-11-24). [Detail](backlog/box.md#bundle-full-disk-the-till-read-that-fails-and-the-words)

- **The Amazon S3 delete and archive rehearsal's open edges (A538-9).** Left open by #1668, in
  `apps/server/src/testing/` (`aws-request-recorder.ts`, `s3-delete-scenario.ts`,
  `s3-archive-scenario.ts`) and the runbook `docs/developers/aws-backup-rehearsal.md`.
  [Detail](backlog/box.md#the-amazon-s3-delete-and-archive-rehearsals-open-edges-a538-9)

- **Backup and restore carry-forwards (B2):** future non-database modules and physical power-loss qualification remain.
  [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **Guide replacement address settings after a cold restore.** Replace manual configuration of
  the public management address and passkey domain with a recovery step that checks they
  match the replacement's address.
  [Detail](backlog/box.md#guide-replacement-address-settings-after-a-cold-restore)

- **A1483. Run natively on ARM before go-live.** The owner asked for ARM support on 10 November, then deferred it until go-live is near because ARM builds are slow.
  The published image and B3 installer currently support amd64 only.
  [Detail](backlog/box.md#a1483-native-arm-image-and-installer-before-go-live)

- **B3. The bootable USB installer** — Box status scans, joins and confirms forgetting saved Wi-Fi; release gates remain; design approved with changes; [six-slice plan](superpowers/plans/2026-10-26-b3-usb-installer.md).
  The owner authorised the build on 2026-11-01, one pull request at a time; [PR 1](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-11-01-b3-1-encrypted-disk.md) (#2370) adds three host libraries under `scripts/box/`, none called yet. PR 2 (#2423, [plan](superpowers/plans/2026-11-03-b3-2-preboot-logic.md)) adds the preboot unlock gate with the proposed 2/4/8/16/32/60-second wait, the locked-mode redirect decision and the Wi-Fi record reader under `scripts/box/`, none called yet. PR 3 (#2426, [plan](superpowers/plans/2026-11-03-b3-3-installer-policy.md)) adds the installer's decisions and its network fallback decisions under `scripts/box/`, none called yet; the signed release list waits for A940's release slices and a chosen signature format. PR 4 (#2430, [plan](superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md)) defines the name tag (a LUKS2 token of Waitron's own type), its decoder, the finder and a write plan, and the Wi-Fi boot copy's writer and its write-or-why-not decision, under `scripts/box/`, none called yet. PR 5 (#2432, [plan](superpowers/plans/2026-11-03-b3-5-wifi-publication.md)) adds the Wi-Fi boot copy's publisher under `scripts/box/`, none called yet: it writes the copy through a flushed staging file, removes it on every "no copy" answer, refuses an unverified boot mount or an unsafe folder or file name with no write, and reports the copy's state. PR 6 (#2433, [plan](superpowers/plans/2026-11-03-b3-6-disk-key-letters.md)) adds the disk recovery key's conversion between 32 bytes and systemd's 64 letters, and reading a typed key back, under `scripts/box/`, none called yet. PR 7 (#2474, [plan](superpowers/plans/2026-11-05-b3-7-host-protocol.md)) adds the box host protocol under `scripts/box/`, whose request writer and reply reader PR 8's client calls (its answer function is called by nothing yet): seven of B3's requests as checked one-line requests with an ids-only actor, their checked replies, and an answer function that calls injected adapters and never puts a Wi-Fi password in a reply, a log entry or another adapter's argument; the clock requests stay on slice 9b's shell handler. PR 8 (#2495, [plan](superpowers/plans/2026-11-06-b3-8-host-client.md)) adds the server's client for those seven requests in `apps/server/src/box-host-client.ts`, called by nothing until PR 9: typed answers, never a throw, and a box with only the clock handler read as not taking them. PR 9 ([plan](superpowers/plans/2026-11-06-b3-9-host-routes.md)) builds it in `boot.ts` and answers six of those requests through routes behind `system.manage`, with the signed-in person as the actor; the development name-tag duty is now bound.
  The [host network read](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-b3-19-network-status.md) connects the protected API to the installed NetworkManager. Installed host scan/join and restart-persistent boot-copy publication are implemented by [Wi-Fi host slice 1](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-b3-wifi-host.md). [Wi-Fi host slice 2a](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-b3-wifi-host-reconcile.md) adds forget and reconciles the boot copy at startup and after operations. [Wi-Fi host slice 2b](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-b3-wifi-host-monitor.md) observes outside NetworkManager changes through the existing worker. [Box status controls](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-b3-wifi-controls.md) scan, join and confirm Forget through that API. Real adapter/restart/power-cut qualification remains open.
  The [development recipe](../bench/box-installer/README.md) installs LUKS2 with five btrfs areas,
  retains its recovery key and seals to a virtual TPM. Its first disk boot requests a restart with Docker stopped;
  two subsequent chip-unlocked boots must remove the empty password and reach setup. The rig independently
  tests the retained key. Setup offers Prepare/Live/existing and refuses Demo.
  The development console shows Spanish and English together, names the checked venue and warns when its tag marks it Live; missing or unusable tags leave Live status unknown. It returns through the firmware's one-time boot choice after 15 seconds; keys pause it until 120 seconds without typing. `existing-stick` completes Prepare, waits for the server's startup counter to clear, then requires a continuous USB-to-disk return, unchanged target hash before installed startup, unchanged chip seal and `/health`. [Return cut](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-11-b3-18b-firmware-return.md). The graphical warning, reinstall controls and physical qualification remain open.
  Signed boot/Secure Boot, other-stick and missing-container checks, failure/recovery screens, key sheets,
  update resealing and physical-device qualification remain release gates. This development cut claims no theft protection.
  No setup codes: the owner closed W60's first-claim concern. Remaining mode work: no same-box re-setup of Live/restored production venues, and
  installed-box choices bound to deployment state. Explicit production setup now refuses Demo/Prepare at the route.
  Every sheet repeats the disk key. Owner ~13:45/~14:00 answers settle locked redirects and the minimal unencrypted normal Wi-Fi copy, with theft/password-change guidance and cable/local fallback; no recovery SSID/hotspot.
Android Chrome controls are UNVERIFIED / NOT RUN; historical constraint failure holds the affected trust design/release for requalification. Build/API and hardware gates remain. [Detail](backlog/box.md#b3-the-bootable-usb-installer)

- **The box image carries the WireGuard link.** [Detail](backlog/box.md#box-image-constraints-b3)

- **Kiosk options, none built:** Chromium in the box image, every box (the owner's decision in B3's
  answers, 2026-10-21), and, later, Fully Kiosk resale for dedicated tablets.
  [Detail](backlog/box.md#box-image-constraints-b3)

- **The box the customer buys probably doubles as a till, so the image ships a screen and a browser** — owner, 2026-09-29; decided in B3's answers (2026-10-21): every box carries Chromium under `cage`, no desktop; its screen opens the dashboard after setup and can become a till like any other device ([B3 design §9](superpowers/specs/2026-10-21-b3-usb-installer-design.md)). [Detail](backlog/box.md#the-box-the-customer-buys-probably-doubles-as-a-till-so-the-image-ships-a-screen-and-a-browser)

- **a local maintenance account on each box** — belongs with B3; a discussion record, not an approved spec. Its remote-support half is tracked in Cloud and not approved. [Detail](backlog/box.md#a-local-maintenance-account-on-each-box)

- **A799. Real historical upgrade testing: folded into [A950's new plan](superpowers/plans/2026-11-09-a950-shorter-upgrades.md) (owner, 2026-11-09).** Its trial of the new release's database changes on a copy of the live data is A950's step 4, now; testing against real older releases is kept from go-live onwards. No separate A799 delivery. [Earlier detail](backlog/box.md#2026-10-23-a799-build-authority-and-history-selection).
- **A1016. Keep every box current and backed up, with no effort from the owner (owner,
  2026-10-22).** "Another super important part of the story especially for on prem is automated
  backups. We need to make it incredibly easy for users to upgrade, hopefully even automatically,
  and to give them good reasons not to fall too far behind, so that we don't end up supporting ancient buggy versions." Builds on the automatic upgrades entry below and on the off-box copy that the setup tour offers but never requires. [Detail](backlog/box.md#a1016-keep-every-box-current-and-backed-up)

- **A1049. The updater honours a version Waitron Cloud marks held (2026-10-24).**
  Belongs with A1016.
  [Detail](backlog/box.md#a1049-the-updater-honours-a-version-waitron-cloud-marks-held-2026-10-24)

- **A1050. A "can this venue trade?" check for a hosted server (2026-10-24).** Cloud's outside
  monitor calls it every minute (design section 5). It must exercise the server, not only its
  front door, and must not write fiscal records. Defined jointly with Waitron Cloud.

- **Automatic upgrades with rollback until a clean, running restart (A950).** The checked manual
  path retains a stopped copy, requires a successful disposable-copy sale
  with the copy told its time is synchronised, and offers Restore/Keep (Restore only when the
  release changes the producer).
  The release job signs and attaches the release file. The retained
  installer checks it before downloading a numbered release. A checked numbered upgrade
  refreshes the keys and verifier. The [offer publisher](operations/release.md#offer-a-release-to-a-group)
  signs and reads back the staged offer. A prerelease such as `1.3.0-rc.1` has its own declaration
  and can be published for checked manual installation. Older lines have
  [release tooling for maintenance branches](operations/release.md#cut-a-release-on-an-older-line).
  Automatic offers take stable releases. You can
  [check the signed offer](../deploy/README.md#checking-the-signed-upgrade-offer) on a numbered box
  and enable overnight checks by hand for rehearsal. The supervised install command applies an
  offer during the quiet window and rolls back a failed candidate. Box status shows the latest
  completed offered install or rollback. Administrators can save, pause or clear the installation
  window in Box status. Still open are the first signed publication, first live offer, physical
  test-box upgrade, automatic timer activation and paired upgrades.
  Paired upgrades also bring two-box venues the change of software producer (A993), which is built for single boxes first (owner, 2026-11-22).
  The password-checked go-back must refuse an upgrade that changed the software producer once its new fiscal installation has opened (A993 plan, decision 2): the old version would write that installation's first record under the old producer.
  Before enabling scheduled installs, measure the timer, download and trial and use the measured preparation time to set the minimum window.
  After the first venue come the Cloud release check, password-checked go-back, proof-of-close and
  backup-stream handoff. Current-build synthetic Linux
  rehearsal does not qualify historical releases, a physical box or the whole shell `install` entry
  on an existing box (driver/bootstrap, non-recipe service/Docker drop-ins, host refresh and
  candidate download/build/pull). The [two-group plan](superpowers/plans/2026-11-09-a950-shorter-upgrades.md)
  records the owner's 9 November decision; the [area detail](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order)
  retains earlier designs, decisions and library limits.

- **Finish the clock work: a check at every start and every change** (bundle of 3, 1 go-live, 2 important, size L, waits for another entry). Holds A798. [Detail](backlog/box.md#bundle-finish-the-clock-work-a-check-at-every-start-and-every-change)

- **Closing a pay period trusts the box's clock.**
  [Detail](backlog/box.md#closing-a-pay-period-trusts-the-boxs-clock)

- **Remaining bucket-copy limits** (an outage on a physical box at a venue's rate of sales; bundle of 1, size S, needs a physical box). [Detail](backlog/box.md#bundle-remaining-bucket-copy-limits)

- **Qualify clock confirmation through remote access** (bundle of 1, size M). [Detail](backlog/box.md#bundle-qualify-clock-confirmation-through-remote-access)

- **A1407. A full invoice AEAT refused for a future date is put right by a replacement R4, built 2026-11-15 but switched off.** The writer and the case dialog's **Put this right** file an R4 "S" naming the same customer and the day the sale really happened, only while `FULL_INVOICE_REPLACEMENT_ON` in `packages/fiscal-verifactu/src/put-right.ts` is true; it is false, so the case dialog still says Waitron cannot put a full invoice right yet, and `computeVatReturn` counts such an invoice in its issue date's period unless it is replaced before that period ends. Turning it on waits for the R4 "S" probe on AEAT's test service (the probe entry under go-live). A simplified invoice refused for a future date is put right from the case dialog with a replacement R5 (Q37-FIX). Since A1420 PR 2, refusals for a future date (`1112`) no longer hold the rest of a chain; a record refused for a future date should get its corrective at once, naming the refused invoice, which AEAT's developer FAQ §17 says resolves it (case 2.a) and AEAT's test service accepted for an R1 (verifactu run 37286368370). Clocks running behind are not listed for the owner. The invoices to correct are those AEAT refuses as dated in the future (`1112`); a wrong date AEAT accepts is not corrected (owner, 2026-11-10; A1420 D8; kept by the owner on 2026-11-18 over the date-corrective plan of question 8 of the [19 November sheet](compliance/2026-11-19-adviser-meeting.md)). Such a corrective goes in a corrective series apart from the tickets (owner, 2026-11-18), and when it moves VAT into or out of a period that has ended, that goes on the corrections workbook of the period it is made in (the VAT return screen's **Download corrections (XLSX)**). An enabled remedy takes the start gate first (A1420 R7). AEAT's `TimestampPresentacion` is read but not stored: kept with each record, it would prove the real time of most sales, and that part needs a column, so it waits for the A1308 table hold to lift. Read, not run. [Findings](compliance/research/2026-11-06-adviser-clock.md)

- **ACCOUNTANT-XLSX. Deferred payments become a sheet of the accountant's download, and the working-time
  file an Excel file** — queued (lane I). Owner, 2026-11-24: "yes, and do we have the option of making them
  google sheets as well?"
  [Detail](backlog/box.md#accountant-xlsx-deferred-payments-join-the-accountants-download-and-the-working-time-file-is-an-excel-file)

- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on every log line — the connection-string shape and nothing else. [Detail](backlog/box.md#the-recovery-pages-secret-bound-is-a-convention-not-a-guard)

- **Resetting a box without a terminal** — open for the recovery page and boxes that joined another box. [Detail](backlog/box.md#resetting-a-box-without-a-terminal)

- **A venue preparing to go live sends real email through SMTP (A987) — BUILD.** Prepare can
  use a mail server or test Cloud for staff email. Settings lets admins
  save and remove the relay, with manager reads and actionable SMTP tests. Users and Account settings
  distinguish queued, captured and unconfigured account mail, and an immediate invitation
  retry says when nothing changed. Ordinary SMTP and Settings tests use the venue sender name.
  A saved server takes priority for invitations, password resets and email-change codes. Demo
  outside development uses test Cloud for those messages when enabled and the practice inbox otherwise.
  A fresh Prepare box that opts into Cloud email and leaves its mail server blank can also
  send the old-address warning, security notices, role changes and selected box alerts through
  test Cloud. A box configured for test filings can send certificate reminders through the same
  relay. The two new notice classes need the compatible Cloud release, and box alerts have a
  joint inbox check pending.
  Left: qualify invitations, resets and email-change codes against the live test Cloud
  (BOX-EMAIL-RELAY), the paid Cloud plan and the remaining free notice work.
  [Detail](backlog/box.md#a-venue-preparing-to-go-live-sends-real-email-through-smtp-owner-2026-10-03--open)

- **A venue on Microsoft 365 uses its own mail server (owner, 2026-11-23).**
  From the end of December 2026 Microsoft switches off password sign-in for sending mail by
  default, so a saved password stops working; support "Sign in with Microsoft" for the venue's
  mail server, but not immediately (owner: "microsoft 365 we should support but not
  immediately"). Until then, a Microsoft 365 venue can choose "Waitron sends as your domain"
  (Cloud's venue-email design).

- **A box in first setup still sends a test email through a mail server whose login the caller
  holds (A987 review, 2026-10-22) — OPEN.**
  [Detail](backlog/box.md#a-box-in-first-setup-still-sends-a-test-email-through-a-mail-server-whose-login-the-caller-holds-a987-review-2026-10-22--open)

### Replication, failover and the cloud

- **A1438. Code Waitron and Cloud share, published like ui-core (owner, 2026-11-08).** The
  box builds pairing and machine requests through the database-free workspace package `@waitron/contract`,
  which also supplies the access-lease format. The box still reads leases through its own saved-state adapter.
  The UI publisher now checks and uploads both packages, including `@waitron-io/contract`.
  The v4 signing format is published in `@waitron-io/contract@0.2.37`. The contract also provides
  a separate v5 encoder and verifier for early setup sign-in. The installed test-box
  [sign-in integration](superpowers/plans/2026-11-20-setup-cloud-sign-in.md) passed a joint test
  on 20 November using Waitron [#3893](https://github.com/clintongormley/waitron/pull/3893)
  and Cloud [#1343](https://github.com/waitron-io/waitron-cloud/pull/1343).
  Configured test boxes also offer sign-in in fresh Prepare and development Live,
  then file the saved venue after restart. Prepare on configured test boxes also offers
  staff email through Cloud and lets you leave the venue mail server blank.
  The administrator form comes before Cloud sign-in in Prepare and when starting empty in
  development Live. The hosted test release and live Google qualification remain open. The address
  picker requires one Spanish business with no tax number or venues. Adding a venue to an
  existing Cloud business still needs manual address entry and wider Cloud support.
  Cloud installs the private package with its workflow token. Remaining: the sign-in
  rules (with A1437 and Cloud's D608), then the message list and texts (with Cloud's D610 and the
  email relay). Roles, storage, sessions and
  screens stay apart. [Plan](superpowers/plans/2026-11-09-a1438-code-shared-with-cloud.md).

- **Everything needing a third box or a Cloud peer** (bundle of 8, 1 important, size L, waits for another entry). Holds A1205, A1275, A1276. [Detail](backlog/replication-cloud.md#bundle-everything-needing-a-third-box-or-a-cloud-peer)

_Formerly _Afterwards_ and _Cloud connection integration_._ Detail: [backlog/replication-cloud.md](backlog/replication-cloud.md).

Not in any track until the standalone primary is done.

- **Address search provider, province names, guide lines** (bundle of 2, size M). Holds A1171, A1171. The [plan to finish it](superpowers/plans/2026-11-24-address-lookup-finish.md) (owner, 2026-11-24) splits it between Cloud and the box. [Detail](backlog/replication-cloud.md#bundle-address-search-provider-province-names-guide-lines)

- **A1018: physical-box qualification remains the owner's.** The local two-box test covers a
  controlled handover and a reset/rejoin emergency takeover with Veri*Factu. Cloud emergency start
  stays with A1188; Cloud-to-box handover stays with A1505.
  A1505 has a [dependency record](superpowers/plans/2026-11-17-a1505-cloud-to-box.md); its build plan waits for P6/D634 and the joint hosted formats.
  [Local receipts and remaining qualification](backlog/replication-cloud.md#a1018-agree-and-build-the-hosted-writer-stop-proof-contract)

- **A947 owns the spare's authenticated switch screen** (watcher, 2026-11-08); the spare's
  dashboard is retired. [Decision](backlog/replication-cloud.md#decisions-and-deliberate-limits).

- **A stepdown that reaches a waiting box after it has decided to go on still restarts it, with
  nothing stopped first.** The box sells under its full start until the restart, which can overlap
  the box taking over. Refusing it instead was tried and dropped: the new main box sends its chart
  once per start (`postChartToSource`), so a refused box could go on selling. Closing it means handing a late
  stepdown to the full start's own handling once that is mounted (`apps/server/src/boot.ts`).
  Left open by WAITING-START-ENDS.


- **A venue with no module that can prepare a promotion cannot hand over.** A venue without
  Veri\*Factu is refused `handover.venue_not_supported` before anything is recorded, because no
  plan yet builds its path, including whose invoice series the new main box takes. A947 3b's table
  expects Slice 5 to reach these venues. Left open by A1018 Slice 5 (Ruling P9).

- **A1342: remaining returned-record facts and qualification.** Payment-clash acceptance is an
  internal API without a screen. Sale lines, reprints and real-box qualification remain open.
  A1342’s marker is now stored and returned invoices are listed. Reports show a general notice,
  without identifying affected invoices or periods. Automatic duplicate identification needs a
  matching rule before it can be planned; acknowledgement, responsibility and resolution remain
  unplanned. A filing result held only by the old box is not applied to a record
  already on the new main; a late payment on an older box's sale whose invoice record the new main already holds is not
  included in this return.
  An A802 correction's row and refund links do not travel (`invoice_corrections` and
  `invoice_correction_refunds` are not in the return), so cash an unfinished correction gave back
  arrives as ordinary refunds, and no correction on the new main can cover it.
  [Detail](backlog/replication-cloud.md#a1342-return-a-stopped-boxs-records-before-reset)

- **A third box's chart can leave another box serving-secondary and filing.** The remaining
  third-box cases from A1342 need their own approved scope; the owner accepted the two-box bucket
  stop as clearing A947 3b-6 on 2026-11-09. [Detail](backlog/replication-cloud.md#a-box-the-chart-no-longer-names-main-keeps-filing-its-earlier-records)

- **Series and module-preparation gaps at handover** (bundle of 2, at least 1 go-live, size M, waits for another entry). [Detail](backlog/replication-cloud.md#bundle-series-and-module-preparation-gaps-at-handover)


- **Two safe handover states stay open for good.** A box handed a fencing chart between the role and
  its record, then killed, stays restricted at `filing_assumed`; one handed it between the venue save
  and the role, then killed, stays a mirror holding an activation row and its own SIF. Neither sold
  or filed in the runs, and no route clears them. Left open by A1018 Slice 5.

- **The spare's wait loop: back-off, reasons, stop signals** (2 remaining entries: chart answers and accepted-copy recognition, size M). [Detail](backlog/replication-cloud.md#bundle-the-spares-wait-loop-back-off-reasons-stop-signals)

- **A1185: a venue not yet connected sees no prices.** Left open by A1185.
  [Detail](backlog/replication-cloud.md#a1185-a-venue-not-yet-connected-sees-no-prices)

- **A1418. A box records how it stopped, and a replaced box stays stopped (owner, 2026-11-07).** One
  admin action takes a box out of service with a full, checked backup; a shutdown waits for an admin
  at the next start, a power cut waits a minute, a restart does not wait.
  [A1418 design](superpowers/specs/2026-11-07-a1418-box-stop-intent-design.md), approved 2026-11-07; plan next.
  A1557 (2026-11-20) added [the shared backup operation](../apps/server/src/backup-supervisor.ts)
  for scheduled and manual backups. A1418 still needs to identify and verify its final copy.

- **A1425. Every restore takes its own identity (owner, 2026-11-07).** A restored box still
  keeps the old box's identity. Part 3, cut to Cloud's emergency copy (Cloud agreed on 15 November),
  gives a copy Cloud placed a machine identity of its own, in three pull requests
  ([plan](https://github.com/clintongormley/waitron/blob/28f9998ef84db3fb671b1e59a7a5916b0d317da4/docs/superpowers/plans/2026-11-17-a1425-3-fresh-identity-restore.md)), all three built: the
  read-only checks of the placed file and the placement that gives the copy its own `node.db`,
  signing key and `trading.env`, which nothing calls until A1188 part 3's locked start; and an
  ordinary start's refusal of a placed copy not yet activated, or started under another id
  (`node.emergency_copy_unactivated`), before it changes `venue.db` or `node.db`. The rest of part 3
  waits for a later part that covers every restore. Part 2, a staff
  route that cancels a sale, is built only if a venue needs one before go-live.
  [Design](superpowers/specs/2026-11-07-restore-takes-new-identity-design.md), approved 2026-11-07.

- **A1188. Someone at the venue can start the venue in the cloud when the box has died (owner,
  2026-10-29).** Part of A1018 and Cloud's P6. Design approved 2026-10-29. The hosted start still waits for Cloud's launcher, part 4's declaration and activation, and year-sized timing qualification. Local selected-backup placement groundwork keeps the spare's own
  identity; since A947 3b-F (#3172) a spare of a Veri*Factu venue can join as well:
  [A1188 design](superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md).
  The emergency-card adapter is built; its facts need Cloud’s display endpoint. The card can reveal a fresh code and list permission/authenticator readiness; Cloud’s code endpoint is still required. The till entrance and recovery-pack emergency page are built, including the entrance without a spare. Backups checks the printed emergency code and Cloud links to the existing pack maker. The hosted runtime remains open.
  [Part 1 plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a1188-part1-emergency-card.md).
  [Part 2 plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a1188-part2-till-facts.md) covers saved facts and the till entrance; Claude reviewed it and the watcher cleared slice 2a on 15 November.
  Cloud agreed the [part 3 proposal](superpowers/plans/2026-11-15-a1188-part3-locked-start.md) on 15 November and its purpose-key input on 17 November (Cloud #1276). Part 3a provides a separate locked HTTPS process with read-only sign-in and memory-only sessions; its [developer API](developers/cloud-connection.md#locked-emergency-copy-api) reuses A1425 placement. Part 3b adds the separate English/Spanish sign-in and actor/expiry page. Cloud launcher, declaration/activation (part 4) and production qualification remain open. The watcher cleared this API cut on 17 November; no owner approval of the key amendment is claimed.
  Lane G agreed the [part 4 confirmation request and replies](superpowers/plans/2026-11-17-a1188-part4-declaration-contract.md). The [Waitron plan](superpowers/plans/2026-11-18-a1188-part4-waitron.md) leaves live use of the locked page's status read waiting for Cloud D115/P6 and year-sized qualification. Live activation waits for Cloud to prove that the old box's remote access and backup writes are refused before it replies confirmed.
  Qualify with a current-baseline year copy before go-live.
  [Detail](backlog/replication-cloud.md#a1188-someone-at-the-venue-can-start-the-venue-in-the-cloud-when-the-box-has-died-owner-2026-10-29)

- **Remaining setup and failover gaps** (bundle of 7, 3 important, size M). [Detail](backlog/replication-cloud.md#bundle-remaining-setup-and-failover-gaps)

**The on-prem mirror.** Two local boxes with failover are built and checked on real boxes; this
section records what remains.

- **A1567. Before the first two-box venue goes live: rehearse the parts the 18, 20 and 23 November
  runs did not show** (watcher, 2026-11-23; the design makes the rehearsal a condition of going live
  on two boxes). On real boxes: a plug pulled mid-sale, the old box rejoining as the spare by
  itself, a switch back, a switch with the internet unplugged, and every box's and till's clock read
  at the start and the end. On till hardware: two-part `.local` names, the name cache after the main
  box dies, a passkey at each way in, and the same-site cookie. Needs the owner at the boxes.
  [Design §11](superpowers/specs/2026-10-21-a947-two-box-failover-design.md#11-build-order-slices-35-as-pull-requests)

- **A1273: the shared key ring has no rotation path to the spare.** A spare gets the main box's
  ring only when it joins. Since 3b-5b, `waitron-credentials rotate` refuses while a pair link
  exists (decision D7); the bucket-copy risk in the detail stays open.
  [Detail](backlog/replication-cloud.md#a1273-the-shared-key-ring-has-no-rotation-path-to-the-spare)

- **A1274: a box that handed over and then loses its node.db can start as a second main box.**
  Could cost a filing.
  [Detail](backlog/replication-cloud.md#a1274-a-box-that-handed-over-and-then-loses-its-nodedb-can-start-as-a-second-main-box)

- **A1296: code-quality follow-ups from A947 slice 3a's finish review.** Parallel venue and node
  handle types, staged node-copy opening and the remaining transaction stages.
  [Detail](backlog/replication-cloud.md#a1296-code-quality-follow-ups-from-a947-slice-3as-finish-review)

- **A1282: browser trust after a connection repair replaces the certificate authority.** The browser
  check refused Servers, alerts and disk-stop reads with `ERR_CERT_AUTHORITY_INVALID`.
  [Detail](backlog/replication-cloud.md#a1282-browser-trust-after-a-connection-repair-replaces-the-certificate-authority)

- **A1552. The Servers page is complicated and hard to read (owner, 2026-11-18; needs the owner
  before anything is built).** The owner's point from the two-box test of 18 November, as that
  session recorded it. A redesign needs the owner to say what the page should show. Seen at that
  test: the spare's delay moving between 1 and 32 seconds, which is how that figure is built.

The membership, promotion and rejoin arc remains in the tree. What remains, largest first:

- **Status, alarms and the operator surface for replication.** An operator needs to see whether the
  standby is keeping up, and to be alarmed when it is not.

- **Fiscal-certificate distribution** — rebuild on the asynchronous adopt. Open design question:
  how the dormant certificate is protected when the seal must happen after the initial copy.
  [Detail](backlog/replication-cloud.md#fiscal-certificate-distribution)

- **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document and pick one
  rule: every role change is a restart, or the worker-lifecycle manager — not both.

- **The mirror as a backup destination.**

**Cloud integration and SQLite work.**

- **Loose ends left by the Cloud connection integration.** Customer remote setup UI and production
  deployment remain open. Continuous complete-server recovery, planned final-write handover and
  production recovery remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-cloud-connection-integration)


- **A951-S provider trials.** Public staff-name changes and certificate renewal still need joint
  qualification. Translate all returned one editable menu suggestion on the test box;
  the live Google address trial remains open. Keep the approved consent and request limits.
  Idle gateway recovery still needs testing through Cloud’s staff and public HTTPS routes.
  [Detail](backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)

- **Waitron retains:** first-contact trust bootstrap; and the cloud-standby end-to-end proof. Do not restart the cloud-standby work until the boundary contract is settled.
  [Detail](backlog/replication-cloud.md#waitron-retains)

- **Loose ends left by the SQLite failover-loop prototype gate.** Provider qualification,
  promotion generations and the Cloud recovery contract remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-sqlite-failover-loop-prototype-gate)

### CI, tests and developer tooling


- **CI incidents to watch.** The table groups retained CI sightings with their evidence and what to retain on recurrence, including the pauses during pnpm archive downloads and the first-hour PDF assertion in fiscal shard 2. [Detail](backlog/ci.md#ci-incidents-to-watch)

- **Finish qualifying CI's server routing and action setup** (bundle of 2, size M). Checked real-run records cover tools/history/API, PR planner pickup, scheduled rescue and idle pickup, one no-op overflow, natural blind fallback and fresh-capacity route choices before later idle alarms, including an idle-server choice followed by successful server jobs and natural agreeing-row stale-count acceptance followed by a successful hosted run. The browser workload passed on disposable runners, and an earlier run supplied venue-service failure diagnostics. A passing full run confirmed the CI-only per-job split and hosted coverage merges. A1424/A1440 still need an image guest, remaining-workflow evidence and the full-day queue measurement. The historical planner cause remains unproved. Planner recovery from short workflow lists still needs natural-run evidence; standalone `check` tolerates short queued lists with an explicit partial observation, while running/job lists and other health commands retain their rules. A935 waits for a natural setup-download stall before its [experiment proposal](superpowers/plans/2026-11-16-a935-action-download-experiment-proposal.md) is revisited; build no new guest capability now, and the job limit remains unqualified. The bundle remains open. [Detail](backlog/ci.md#bundle-qualify-cis-server-routing-and-action-setup)

- **Get ready for A1308's history rewrite (A1306 and CI's concurrency groups)** (bundle of 2, 1 important, size M, waits for another entry). Holds A1306. [Detail](backlog/ci.md#bundle-get-ready-for-a1308s-history-rewrite-a1306-and-cis-concurrency-groups)

- **A1251. Finish qualifying and reviewing historical PRs that skipped the Claude run-it review.**
  Exclude documentation-only changes, verified test-data/name renames and changes already reviewed.
  Review each remaining squash against its parent and check findings against current main before
  opening a repair.
  [Detail](backlog/ci.md#a1251-finish-qualifying-and-reviewing-historical-prs-that-skipped-the-claude-run-it-review).


For package distribution and the four-minute target, use the
[CI job layout](developers/ci-and-gates.md#ci-job-layout-and-scheduling) and the
[duration-table refresh instructions](developers/ci-and-gates.md#package-duration-tables).
For db, ui-core and ui mutation
packing, use their [cost-table refresh instructions](developers/ci-and-gates.md#dbs-mutation-shards-are-packed-by-estimated-cost).


For browser storage checks, inspect the operation's own entry and every write, comparing complete
values rather than PIN substrings inside random IDs. See the
[testing guide](developers/testing-guide.md#check-stored-secrets-as-values-and-inspect-every-write).
The cited refund test checks `setItem` calls and its own final entry; direct property assignments
under another key fall outside that check.

- **Whether the checkout stalls were a GitHub-side incident remains unverified (A935).**
  A1178 adds checkout-stage traces and stored-pack measurements in CI and licence jobs;
  a hosted recurrence reached `fetch_refs` with an unfinished `index-pack`, without distinguishing
  transfer from indexing.
  [Detail](backlog/ci.md#whether-the-2026-10-20-checkout-stalls-were-a-github-side-incident-was-not-checked-a935).

For database fixtures filtered by business day, make the boundary explicit and exercise the
changeover. See the [testing guide](developers/testing-guide.md#a-recent-timestamp-can-belong-to-the-previous-business-day).

- **Vitest settings: remaining measurements** (bundle of 2, size M). Worker pins need a loaded runner, and the setup optimizer control was inconclusive. [Detail](backlog/ci.md#bundle-vitest-settings-remaining-measurements)

- **A1398. Test-file inventory only on a same-count mismatch** (1 conditional entry). [Detail](backlog/ci.md#bundle-a1398-pack-the-other-packages-test-shards-by-measured-time)

- **A668-5. Remaining captured root-test failures.** [Detail](backlog/ci.md#a668-5-normal-push-recurrence-2026-10-16).

- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites and a
  shared `useFiscalMirrorPair()` for the two-clone fiscal suites.

- **What the stream pause test's last-restore fix (A387, #1398) left open:** a local Linux run
  keeps the machine's own loopback and can still meet the stall (how often was not measured), and a
  box's restore over a real network was not measured.

- **Unused peers, versitygw binds, fiscal callers and saved-origin restarts still need port ownership (A80/#740, A907, A1152).**
  [Remaining caller audit](backlog/ci.md#what-the-landing-port-fix-a80-pr-740-left-open).
- **Give the failover bench an endpoint that stays refused for its lifetime**, preserving its bounded actual-ECONNREFUSED probe and SDK/Litestream consumers.
  [Detail](backlog/ci.md#give-the-failover-bench-an-endpoint-that-stays-refused).

- **drizzle-kit 0.31.11 left out `ON DELETE` when it generated an `ALTER TABLE … ADD … REFERENCES` on this engine, while its snapshot kept it.**
  [Detail](backlog/ci.md#drizzle-kit-03111-left-out-on-delete-when-it-generated-an-alter-table--add--references-on-this-engine-while-its-snapshot-kept-it).

### Dependency upgrades

_Formerly parts of B9 and Track C._ Open work:
[backlog/dependencies.md](backlog/dependencies.md).

- **A Vitest 5 retry still needs mutation qualification after the Stryker 10.1.1 update.**
  [Detail](backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it)

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  [Detail](backlog/dependencies.md#collapse-the-two-typescript-entries-back-into-one-once-typescript-eslint-supports-version-7)

- **What package manifests declare: floors and the root engines line** (bundle of 1, size S). [Detail](backlog/dependencies.md#bundle-what-package-manifests-declare-floors-and-the-root-engines-line)

- **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo.**
  [Detail](backlog/dependencies.md#the-default-browser-floor-rose-and-no-browser-floor-is-stated-anywhere-in-the-repo)

- **The till's QR pin compares the code against itself, not an authority.**
  [Detail](backlog/dependencies.md#the-tills-qr-pin-compares-the-code-against-itself-not-an-authority)

### Modules, data and code health

_Formerly B8, parts of B9, and the old Track C's correctness items; part of A9._ Detail: [backlog/architecture.md](backlog/architecture.md).

- **Query plans and indexes, measured on a year of data** (bundle of 2, 2 important, size M, waits for another entry). [Detail](backlog/architecture.md#bundle-query-plans-and-indexes-measured-on-a-year-of-data)

- **A1308. Rationalise the tables, background jobs, environment variables and files** (owner,
  2026-11-02: "over engineered and disjunct … each bit has been designed in isolation"). The
  [design](superpowers/specs/2026-11-02-rationalisation/README.md) is written, and the owner has
  reviewed every file and answered every question (2026-11-04). **Approved by the owner, 2026-11-04, and the top priority: it runs before more code is built on the old tables.**
  Lane A runs it, once A1018's current slice ends. Slice 0's protection list is built ([how to use it](developers/testing-guide.md#the-protection-list)); so is its bench ([how to use it](developers/testing-guide.md#the-bench)). [A760's squash into eight sets](superpowers/plans/2026-11-04-a760-squash-into-eight-sets.md) has landed; the shared-table work is under way. 246 tables become 145. The server reads settings through the shared environment inventory and reports
  unknown names at startup. The SMTP sender lives in the mail settings document, with its connection
  URL sealed.
  Privacy details now live in venue settings, and legal-name and credential changes keep activity history.
  Ended dashboard sessions are deleted; sign-in history comes from activity records. Email-change
  proofs use the pending address without copying it into the proof row.
  Invoice delivery records describe the request and its outcome. The shared mail and print queues keep the retry schedule and active claims.
  The till can take whole or part payments on a presented bill before its invoice is issued.
  The counter saves its basket and takes payment in one request.
  Veri*Factu reads the chain head from the latest fiscal record on the box.
  Fiscal history retains verified clock steps and replaces the three old clock-stop tables.
  Fiscal history also retains conflicts found in AEAT replies and lookups.
  The shared mail queue sends certificate expiry reminders weekly from the warning date and
  daily during the urgent period and after expiry.
  Orders and Sales can run the receipt helper, receipt line, VAT table, invoice selection,
  Find a bill search and date, bill allocation, receipt figures, receipt issuer, invoice typing and receipt facts suites independently.
  When changing receipt lines, also run the server's `receipt-document`, `receipt-document.set-menus`,
  `invoice-document.set-menus`, `receipt-ticket`, `invoice-layout`, `receipt-adjustments`,
  `list-unit-price.fiscal-identity`, `orders-list`, `portion-sale-projection`, `order-group`,
  `working-order`, `issuance-pass` and `free-item-share` suites. When changing the VAT table,
  also run `receipt-ticket`. When changing receipt figures, also run the server's
  `receipt-adjustments`, `invoice-document`, `invoice-layout`, `receipt-document`,
  `invoice-document.set-menus`, `receipt-document.set-menus`, `receipt-ticket`, `invoice-language`
  and `free-item-share` suites. Changes to filed values follow [A1308 slice rule 6](superpowers/plans/2026-11-08-a1308-slice-rules.md#6-who-lands).
  When changing receipt issuer or invoice typing, also run the server's `receipt-issuer` (real till and fiscal backend), `full-invoice-creation-date`, `invoice-recipient-flow.e2e`, `invoice-document` and `invoice-email` for saved and issued documents, and `tender-refund-receipt`, `transaction-receipt-api` and `bill-payments` for refunds, original receipts and payment replay, plus `receipt-device-evidence` for the till's stored invoice evidence.
  When changing receipt lines, receipt figures, receipt issuer or invoice typing, also run Orders
  and Sales' `receipt-facts` suite. When changing receipt facts, start with the server's
  `receipt-document`, `receipt-document.set-menus`, `invoice-layout`, `invoice-layout.widths`,
  `invoice-document`, `invoice-document.set-menus`, `receipt-ticket`, `invoice-language`,
  `invoice-pdf`, `invoice-raster`, `free-item-share`, `receipt-deferred-payment`,
  `till-receipt-preview`, `receipt-advances`, `receipt-adjustments`, `receipt-print`,
  `receipt-guests.routes`, `receipt-preview-api`, `sample-receipt` and `receipt-language` suites.
  When changing a shared fixture, find its server consumers with
  `git grep -l -F -e full-invoice-fixture -e receipt-cases -- apps/server` and run their suites.
  Changes to filed values follow [A1308 slice rule 6](superpowers/plans/2026-11-08-a1308-slice-rules.md#6-who-lands).
  The Find a bill routes and readers remain in the server. When changing the parser, also run
  the server's `find-bill-api`, `find-bill-bills`, `find-bill-transactions`
  and `bill-advances` suites to check the HTTP routes and bill and transaction data. When changing
  the shared search limit, also run the server's `orders-api`, `tax-office-list`, `bill-lookup-api`,
  `report-api.returned-invoices` and `bill-payments` suites for their search-length cases.
  When changing bill allocation, also run the server payment, receipt and advance suites named in
  the bill allocation plan. For changes to `invalid`, `MONEY`, `money`, `ZERO` or `cashChange`,
  find the server users with `git grep 'bill-allocation\.js' -- apps/server/src` and run their
  focused suites. When changing `bill.nothing_outstanding`, `bill.tip_not_allowed`,
  `bill.allocation_changed` or `order.payment_in_flight`, search the server for that error code
  with `git grep -F '<error code>' -- apps/server/src` and run the affected tests.
  Changes to filed values follow [A1308 slice rule 6](superpowers/plans/2026-11-08-a1308-slice-rules.md#6-who-lands).
  Future order and sale changes follow the [package convention](developers/conventions-data.md#order-and-sale-code-belongs-in-packagesorders-sales).
  [Bill allocation](superpowers/plans/2026-11-24-a1308-bill-allocation.md)
  [Detail](backlog/architecture.md#a1308-rationalise-the-tables-background-jobs-environment-variables-and-files)
  What it retires, listed until each slice lands: [What A1308 retires](backlog/architecture.md#what-a1308-retires).

- **`drawer_opens`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
  [Table restrictions after the grants audit](backlog/architecture.md#remaining-table-restrictions-after-the-grants-record-audit)

- **Small checks and indexes that are cheap only inside A1308's fresh tables** (size M). [Detail](backlog/architecture.md#bundle-small-checks-and-indexes-that-are-cheap-only-inside-a1308s-fresh-tables)

- **Cloud's shared UI release still needs dependency updates and portal qualification.**
  Waitron's [release workflow](../.github/workflows/publish-ui.yml) checks and publishes
  the private package on main pushes changing `packages/ui-core`. Its
  [first publication](https://github.com/clintongormley/waitron/actions/runs/42376444927)
  released `@waitron-io/ui-core@0.2.1` from `47dda656b641794051c64d3752937ea7f2929f51`.
  The downloaded registry tarball records that source commit and carries both licence files;
  package metadata still reports private visibility and the Cloud repository association. The
  [release guide](developers/shared-ui-preparation.md) explains local inspection.
  Cloud's D579 owns dependency updates, the seven-day lag check and portal/image
  qualification under the [approved simple release plan](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/plans/2026-11-06-simple-private-ui-release.md).

- **Loose ends left by the tenant-column removal (#378, 2026-09-16).** Index and key names that
  still read `tenant`.
  [Detail](backlog/architecture.md#loose-ends-left-by-the-tenant-column-removal-378-2026-09-16)

- **Go-live day steps.**
  [Detail](backlog/architecture.md#go-live-day-steps).


- **Full-invoice recipient: country code names** (bundle of 1, size S). [Detail](backlog/architecture.md#bundle-full-invoice-recipient-country-code-names)

- **Regional demo screen qualification.** Inspect the seeded till, kitchen and dashboard in both
  screen languages, themes and phone/desktop widths when the stack is available. The regional cuts'
  local Mailpit start refused the absent Docker socket. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **Qualify the split-table new-bill no-sale check.** Find a control that reaches the existing
  no-sale assertions with an unwanted sale or record. Existing probes have not established that
  they can fail; no product defect has been demonstrated.
  [Detail](backlog/architecture.md#a974-review-assertion-gaps).

- **A976. Finish the server's English test-venue defaults.**
  The detail also lists private staff, dish and record names still to check.
  The VAT-class, issue-rate, line-transfer and move/merge filing suites use Administrator for their staff sample; their location and dish samples remain.
  Local invoice-correction and fiscal-sale route staff samples use Martha, Administrator, Cashier and Supervisor.
  Local workforce-export staff use Martha Canary, Colleague Green, Anna Admin and Lewis Manager;
  the adjustment-approval and box-email incident samples use Paul and Anna.
  Local session-person and recovery-page route fixtures use Anna for their staff display sample.
  The shared party venue uses Administrator for its staff display sample and station authorizer readbacks.
  The invoice-PDF download suite uses Martha for its manager sample and audit readback.
  The recovery-pack status suite uses Martha Green for its staff sample and name readback.
  The single- and multi-bill editor suites use Anna and Lewis as local staff samples.
  The `floor-today-*` route suites use Anna as their staff sample.
  Local course-retention, service-step, status, kitchen-note, allergy, today-join, course and party route fixtures use Anna for staff.
  The provision, setup-api.throwaway, break-glass-command and
  backup-api.settings-evidence suites use Administrator for their local administrator display-name samples.
  The setup-api and setup-api.throwaway suites use Anna Mary and Smith Green for their administrator real-name samples.
  The backup-api.route and mirror-bundle-api suites use English staff display-name samples.
  The unpaid-departure suite uses Sophia for its local supervisor sample.
  The device-equipment and device-levers suites use English staff display-name samples.
  Local floor-signal, pairing and till clock-state staff samples use Lucy, Anna and Lewis.
  The attendance-discovery, attendance-obligations, boot.mirror, boot.clock-watch and standalone tab-person suites use Anna and Martha for their main staff sample.
  Account-invitation and box-alert-email duty staff samples use Anna; so do the two-role invitation
  and personal-data README literal-replacement examples.
  Local till table, zone-layout, zone-required, split-bill, floor-catch-up and today-names suites use Anna for their staff-role person.
  The device-join suite uses Server and Manager for its local staff-role display samples.
  The main till API and profile-zone suites use Anna, Martha and Beatrice where present; local
  delivery, published-menu sale and unroutable-dish staff samples use Cashier.
  Local box-host, box-health, disk-stop and clock set/confirm route fixtures use Martha, Anna
  and Simon for their manager, administrator and supervisor samples; the clock suites' administrators remain Mario and Berta.
  Local alert, box-host call, attendance-fact, bill-editor transition, deferred-close and orders
  route fixtures use English staff display-name samples.
  Local portion-sale projection, station-queue and station-move staff samples use Anna and Lewis.
  Local adjustment-report staff use Lucy, Paul and Rose; `till-session.person` and box-alert-email samples use Anna.
  The own personal-data download (`personal-data-export-api.own`) and box-health samples use Martha and Rose; stream-route and cross-person profile administrators use Administrator.
  Local personal-data export, staff-export and working-time record suites use Martha Lewis; the staff-export suite's administrator sample uses Anna Admin.
  The adjustment-download worked example uses Martha Lewis, Lewis Green, Paul Gray and Anna Smith;
  local reprint and restore-archive staff samples use Anna.
  The shared clock venue uses Anna for its staff sample and matching attendance, approver and profile-export checks.
  The shared signed-in-till venue uses Anna and Administrator for its staff display samples.
  The shared adjustment venue uses Anna and Martha for its staff and manager samples.
  The shared bill and order venues use Anna, Administrator and Sophia for staff samples.
  Local receipt-language, receipt-guests, till-receipt, promotion-endpoint and till-reroute
  fixtures use English staff display names.
  Local `issuance-pass.test.ts`, `till-sale-tender-block.test.ts`, `sale-till-source.receipt.test.ts`,
  `served.test.ts`, `report-api.categories-reconcile.test.ts` and `demo-seed.db.test.ts` use English staff display names.
  The recovery-page personal-data suite uses Martha Lewis and George Hill as staff samples. Its Spanish venue legal-name, location and table-name samples remain.
  The shared boot provision-body and stream-pause fixtures use Administrator for their staff display sample.
  The menu include-folder, menu-patch and menu-schedule route suites use English staff display names.
  Local former-number station and today-name counter-group samples use English; accented group names (García birthday) and the Ana party name remain.
  Other local and shared staff-name samples still need triage; preserve deliberate name and locale cases.
  Logger personal-name samples use English names, except the deliberate accented `Àngel` cases
  and short-email `ana@bo.es` sample;
  made-here and till-table supervisor display samples use English names.
  Location and dish samples remain in the issuance-pass and list-unit-price fiscal-identity,
  served-at-fiscal-hash, split-bill fiscal and tabs filing suites.
  Remaining local venue seeds, including email and the other sale suites, and the boot helper's raw
  location names should use `Main room`, as `setupVenue` does. The till-sale suite uses Main room,
  Administrator, Food and Drinks for its local staff samples; its product and fiscal text remain. Current-order, order-group,
  order-draft, served, certificate, backup-settings and backup-room fixture names use it. The shared
  `setupVenue` uses Administrator, Drinks, Coffee and Water.
  Local published-menu, menu-patch, current-order, integrated-sale, delivery, pay-and-dispatch
  and stuck-payment fixtures use Administrator, Main room and Drinks where present.
  Other display samples in those files remain.
  PartyVenue uses Red wine bottle and Water as staff keys,
  with customer Rioja crianza / Agua mineral and kitchen TINTO / AGUA unchanged.
  The main till API and table-route fixtures use Daily menu and Drinks for menu/category labels;
  their Spanish product samples (Agua mineral in both, Cerveza in the till API) remain.
  Local draft, party-seating, zone-refusal, tab, split-bill and move/merge fixtures use Daily menu
  for menus and Drinks or Dishes for renamed categories; the tab suite's category stays ES drinks.
  Other display samples in those files remain.
  The published-menu sale fixture uses Dishes for its staff category and Desserts/House desserts
  for its staff section; its Spanish customer section name and product/modifier text stay.
  The till API modifier fixture uses Cheese, Preparation, Cold and Hot for distinct staff
  names; the till-sale size option uses Size and Large. Their customer and kitchen wording stays.
  Local party-suite table, party, course and printer samples use English. Shared dish samples
  remain in their helpers and consumers, including party bill-action, bill-move, arriving-dish
  and receipt-guest suites. Till-API bill-move/groups/fiscal-sale and order-portion filing
  suites still use Spanish display samples; fiscal-sale test descriptions,
  other shared-helper names and their consumers' dish selectors and screen expectations remain.
  Triage receipt-document fixture text there while preserving Spanish receipt output and locale checks.
  Low priority.
  [Detail](backlog/architecture.md#a976-finish-the-servers-english-test-venue-defaults).
  BillVenue's receipt printer, card readers and cash till use English display names.
  Local device-equipment and office-printer route fixtures use English printer and reader names;
  their shared BillVenue device names and venue/operation samples remain.
  Venue-service's test files are off the list: ordinary samples are English, fixed Spanish screen
  labels are read from its strings table, and the files that still need non-English text are held
  at their counts in `KEEPS_NON_ENGLISH`, each with its reason; staffing is next.

- **Correct every sentence known to be false, then finish comment pruning** (bundle of 1, size M). [Detail](backlog/architecture.md#bundle-correct-every-sentence-known-to-be-false-then-finish-comment-pruning) The pruning sweep still has `bench/` and `scripts/fake-bluez.py` open.

- **Printer, reader and device delete wording** (bundle of 1, size M, needs the owner). [Detail](backlog/architecture.md#bundle-printer-reader-and-device-delete-wording)


- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).


- **Every read route now takes the venue's exclusive write lock and issues a DELETE** — OPEN.
  **Next action:** decide whether a read-only body should take the lock at all.
  [Detail](backlog/architecture.md#every-read-route-now-takes-the-venues-exclusive-write-lock-and-issues-a-delete)


- **Loose ends left by A483 (#1544).** Unselected fiscal protection, changed-trigger repair and
  the recursive-trigger check remain open.
  [Detail](backlog/architecture.md#loose-ends-left-by-a483-1544).

- **Guard asynchronous work sharing one transaction.** Await helpers in turn; the adapter warns
  that overlapping asynchronous nested transactions can release savepoints out of order
  (`packages/store/src/node-sqlite-adapter.ts`). The enforcement gap remains open.
  A per-connection runtime guard with async-context and open-parent tracking was tried on
  `fix/f-async-tx-guard` (`9c934f305c`), then parked by the watcher, 2026-11-17 00:14; it is not shipped.
  Run-it probes found a late child restoring a finished ancestor and refusing later writes
  (`~/waitron-campaign-f/receipts/async-tx-guard-20261116/run-it-b.md`); after that correction,
  catching the sibling refusal could still commit a child's late write outside the transaction,
  and legitimate callbacks were wrongly refused (`settlement-a.md`, `settlement-b.md` in that folder).
  The simpler proposed next step is a source-reading test flagging `Promise.all` over a
  `Transaction` inside `withTransaction` bodies — weaker than its name: source matching would not
  prove that aliases or indirect helper calls are sequential. Do not build it yet (watcher).
  See `docs/developers/conventions-data.md`, "Multi-table writes share ONE transaction".

- **A1544. Measure the real box's memory use and database-cache allowance.**
  The 366-day / 91,500-sale comparison completed uncapped, at 8 GiB and at an assumed 7 GiB.
  The 7 GiB run's counter-sale median was 13.752 ms against 12.323 ms uncapped; host load was
  not controlled, and actual appliance service use remains unmeasured. Measure that remainder
  on the appliance before treating either envelope as its available cache. No archiving decision
  changes. [Results, limits and retained dataset](developers/a1544-memory-measurement.md).

- **SP-4 — the module UI surface on the TILL** (card-registry inversion, self-sourcing cards); the
  dashboard half is done. Migrate the remaining core dashboard screens onto the module UI seat.

### Data protection and legal compliance

_Formerly entries spread across the old sections._


- **A1405. Erasing a person's data blocks it first, inside the database (owner, 2026-11-06).** The AEPD says erasure means blocking, then destroying (Informe 0148/2019; LOPDGDD art. 32). The owner chose real blocking over the sealed file of art. 32.4, which is allowed only where the system cannot block. An erased value leaves every screen, report, search and export, stays usable only for a claim, the authorities or the person's own request, and is destroyed when the period ends, three years where no other period applies. A980's S9 and S11 and A664's removal need this, and a restore must not make blocked values readable again. The shape the owner found reasonable, for the plan to test: one restricted table of blocked values, so that no ordinary read has to remember to skip anything. The original row stays with its field blanked. Each blocked row names its source table, row and field, the value, an erasure group, the date, the reason and the destroy date. The source is a plain table name and id, not a foreign key, and a blocked row outlives a source row that routine clean-up removes. Lookup starts from the record (Show blocked details) or from the person (a restricted search by name, phone or email, then the erasure group). One separate permission, and each look records a reason in the activity record. A restore re-applies erasures made since its backup. It adds a table, so it waits for the A1308 table hold to lift. [Findings](compliance/research/2026-11-06-adviser-privacy.md)


- **A1077. The core table `order_group_hold_stations` has no retention row** (added by A756 PR 6;
  `docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md`, its 2026-10-23 line); its
  retention policy is the owner's to choose.

- **A664 — archive or delete a venue's old data once it no longer has to be kept.** Revised
  proposal adopted for specialist review (owner, 2026-10-17); relevant adviser agreement,
  build and verification remain open.
  Stays in the backlog until the advisers answer; question 48 is the owner's to send (owner, 2026-11-09).
  [Detail and audit](backlog/data-protection.md#a664--archive-or-delete-a-venues-old-data-once-it-no-longer-has-to-be-kept)


- **Third party licence notices** (bundle of 2, 2 important, size S, needs the adviser). [Detail](backlog/data-protection.md#bundle-third-party-licence-notices)

- **A980 — data protection, Waitron's side.** Design revision 2 (2026-10-24) records the owner's
  ten answers. The staff download still needs the remaining fiscal and module actions. S9 and S11
  wait for the specialists.
  [Detail](backlog/data-protection.md#a980--data-protection-waitrons-side)

### Later and parked

_Formerly the "Later and parked" paragraph under What's built._

**Later and parked** (no owner decision pending; reopen when work reaches them).

- **A1507. Google sign-in, built in, through one Waitron-owned Google setup.** Not a go-live
  requirement (owner, 2026-11-11). [Detail](backlog/later.md#a1507-google-sign-in-built-in-through-one-waitron-owned-google-setup)
[Detail](backlog/later.md#later-and-parked)

---

## Coordination between sessions

Each piece of work runs in its own worktree so sessions do not edit the same files. Rules, each
already paid for:

- **Concurrency follows measured headroom, never a count** (CLAUDE.md §2). Before a heavy run check
  free memory and the heaviest processes, then scale to what is free.
- **Whoever lands second rebases — only on a GitHub conflict or a failed landing check.** A PR that
  is merely `BEHIND`, or whose code overlap passes the four landing checks, lands as is with
  `gh pr merge --squash --admin` (CLAUDE.md §6). Module-owned
  migrations are regenerated on rebase per CLAUDE.md §3's recipe.
- **Shared files:** `apps/server/src/boot.ts`, `CLAUDE.md`, `packages/db`'s core schema and
  migrations, the dashboard printers screen, and this file (each session edits its own entries).
- **Instruction housekeeping keeps rules in `CLAUDE.md` and receipts in the developer topic files.**
  Follow §7. See the [pointer limits](developers/writing-claims.md#root-instruction-receipts-retained-on-2026-10-14)
  and the [CI](developers/ci-and-gates.md#root-receipts-moved-on-2026-11-24),
  [UI](developers/conventions-ui.md#root-receipts-moved-on-2026-11-24) and
  [data](developers/conventions-data.md#root-receipts-moved-on-2026-11-24) excerpts from 24 November.
  There is no size gate.
- **Comments are cut on touch, and pruned deliberately one package per pull request** (CLAUDE.md
  §1) — see _Modules, data and code health_ → _Prune the comments_.
- **Update this file as entries finish**, in the same PR (_How to keep this file honest_).

**Run path (local; no hardware, cloud, or AEAT cert):** `wa-wt demo <worktree-name>` → default till
<http://localhost:5190/till/>, dashboard <http://localhost:5191/>, setup <http://localhost:5192/setup/>, server
:8080 (the owner's stack; Claude's stacks get the ports `wa-wt ls` shows). The till enrols itself
on first load in dev mode. Till PIN **5555**; dashboard **owner@demo.waitron.local / dashPass123**.
`dev:setup` seeds three menus (~44 products with images), a floor plan (5 zones / ~16 tables),
staff on PIN 5555, and ~28 days of back-dated preproduction sales — seeded in English by default,
Spanish via `WAITRON_SEED_LOCALE=es-ES`, except the customer-facing languages, which are the Madrid
venue's: Spanish by default with English beside it. `wa-wt onboarding <worktree-name>` for a fresh
shipping-style wizard; `wa-wt reset demo|onboarding [worktree-name]` wipes and rebuilds the owner's
shared venue (Claude: from the main checkout only); `wa-wt reset own demo|onboarding <worktree-name>`
rebuilds Claude's own copy.

---

## Standing decisions

- **A box in setup mode may be trusted by mistake while it answers the venue's name; accepted, with a warning where it offers its certificate (owner, 2026-11-21, A947).** [Decision and limits](backlog/replication-cloud.md#decisions-and-deliberate-limits).

- **Main pushes keep quick checks; package tests run on PRs and full runs (owner, 2026-11-08, A1452).** [Exceptions and merge-risk decision](backlog/ci.md#decisions-and-deliberate-limits).

- **Keep the pre-push hook quick, with typechecking retained (owner, 2026-11-08, A1449).** The hook checks changed files for English (owner, 2026-11-24). [Decision and limits](backlog/ci.md#decisions-and-deliberate-limits). [Hook scope](developers/ci-and-gates.md#the-pre-push-hook).

- **Older PR heads may lack a newer workflow's browser smoke script (watcher, 2026-11-08, A1402).** Skip only an absent script with a notice; current source guards require it and existing script failures stay fatal. [Decision and limits](backlog/ci.md#decisions-and-deliberate-limits).

- **Investigate CI failures before retrying (owner, 2026-10-31, A1243).**
  [Decision and limits](backlog/ci.md#decisions-and-deliberate-limits).

- **Dashboard live reads follow the document lifecycle (A1229, 2026-10-30).**
  [Decision and limits](backlog/dashboard.md#decisions-and-deliberate-limits).


- **Joining tables suggests their combined seats, still editable (A747, owner, 2026-10-16).**
  Implemented for the till's joining and split windows and the dashboard's Add joined table.
  [Decision and limits](backlog/till.md#joined-table-seat-suggestions-owner-2026-10-16-a747).


From the 2026-09-05 whole-project design review and since. They supersede older spec text where they
conflict.

- **Box image identity (A490, owner 2026-10-11):** the script reports the commit and build time
  of each running Waitron image. [Decision](backlog/box.md#decisions-and-deliberate-limits).

- **One tenant per database everywhere, the cloud included, and the schema carries no tenant
  column** (2026-09-14; #378). A tenant is one taxpayer (`country` + `tax_id`), held as the single
  row of `tenants` with its `id` pinned to 1. Nothing filters a query
  by a tenant; a query that wants "this tenant's rows" reads the table. Guard:
  `scripts/no-tenant-column.test.ts` (text-matching, and blind to test files). The cloud is a
  dedicated instance per tenant, hosted in Spain — a server process and a SQLite file streamed to
  object storage. Density comes from many isolated instances per host. The only multi-tenant pieces are a small control plane and the preproduction
  trial demo. Since A1308 vb1 (2026-11-14) the table is `taxpayer`.
- **Warm standby plus human promotion; active-active is shelved.** Nothing was deleted for it: branch
  **`shelved/active-active`** (= `main` at `c65d3cbe`, 2026-09-05) is the snapshot to return to.
- **Modules are core to the product** (opt-in domains, third-party modules later); fiscal is swappable
  by jurisdiction (Veri\*Factu / TicketBAI / none). New domains land as modules, and no new core table
  without a stated reason (CLAUDE.md §3).
- **Rerouting lives in the till web app** for every device kind; the device credential stays an
  httpOnly cookie. A native agent is built for hardware only, printing first.
- **No relay.** Remote access is the cloud instance forwarding the box's name down the box↔instance
  WireGuard link without terminating TLS. Litestream streams the venue database to the owner's
  bucket, not over this link; a promoted node following that stream is future work — see
  _Replication, failover and the cloud_.
- **Handheld kiosk mode is optional, never required** (owner, 2026-09-08) — the baseline is an
  installed home-screen web app plus the till's staff PIN. **The venue OWNS the handhelds** (owner,
  2026-09-18): a member of staff's broken phone is the venue's liability, so lockdown and a
  certificate install are available. Buy a cheap Android with an autofocus camera, plus a spare; NFC
  is optional and Android-only. Decisions and receipts:
  [2026-09-18-handheld-and-till-hardware-decisions.md](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md).
- **Comments carry invariants, not history, and deliberate pruning sweeps are wanted** (owner,
  2026-09-23; CLAUDE.md §1) — see _Modules, data and code health_ → _Prune the comments_.
- **The coverage bar is negotiable only where the rest of a package's gap could be closed solely by
  tests that assert nothing useful** (owner, 2026-09-23): "we never want to add junk tests just to
  meet a coverage bar. the tests added must actually test something useful."
- **Every package and the root project hold the high coverage bar, `98/98/98/95`** (owner,
  2026-09-23) — see [ci-and-gates.md](developers/ci-and-gates.md#coverage-thresholds-one-bar-for-every-package).

---

## What's built (state per sub-project)

Architecture §2's twenty sub-projects, plus the cross-cutting infra. "Remaining" is the unstarted or
partial scope; the detail for a live thread is in its area.

| #   | Sub-project                  | State                                                                                                                                                                                                                                                                                                                                                                                                                             | Remaining                                                                                                                                                                     |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Design system                | `@waitron/ui` token layer + primitives (`--wt-*`); conditional Popover fallback for setup, dashboard and till; brand assets (#284); the till web-app manifest and its icons; the dashboard shell restyle — collapsible nav, account menu, profile modal (#333)                                                                                                                                                                                                                                | sorting `wt-combobox` options (_Users, sign-in and the dashboard shell_)                                                                                                      |
| 2   | Sales spine                  | Immutable hash-chained sales, per-node series, menu, the one-taxpayer model                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                             |
| 3   | Fiscal layer                 | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`)                                                                                                                                                                                                                                                                                   | F3 asesor/XSD confirmations; the owner's real-certificate checks after A795 lands (A888); cert distribution to a promoted node      |
| 4   | Payment layer                | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration and adoption (#323, #329)                                                                                                                                                                                                                                                    | webhook `recordSale` hand-off; reconcile remediation UI; Tap-to-Pay on the handheld (_Payments and card readers_)                                                             |
| 5   | Identity                     | persons/sessions, PIN (+ wrong-PIN back-off: per device at sign-in and for override PINs), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); a one-time passkey offer on first password sign-in (#347); identity state replicates to a standby                                                        | security-change emails; mid-shift-suspension enforce; discount gate; till-refund enforce                                                                |
| 6   | Venue                        | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297)                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                             |
| 7   | Counter POS                  | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, receipt configuration, receipt/drawer printing, cash-drawer authorization — operable end to end                                                                                                                                                                                                                                                        | —                                                                                                                                                                             |
| 8   | Reporting                    | drawer counts and withdrawals, live daily sales, VAT summary, modelo 303 output+input VAT + DR303 file and its download route and its dashboard screen, purchase-invoice UI; dashboard sales screen (with a category sales report, at time of sale or current, printable) + business-overview home                                                                                                                                                 | fiscal filing remainder parked (_Reporting — the fiscal remainder_)                                                                                                           |
| 9   | Deployment                   | the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); boot diagnosability (#310); CA-trust onboarding + per-OS certificate walkthrough (#330); till reroute S1–S6; promotion endpoint (#272)                                                                                                                                                                                     | USB installer (B3: physical qualification remains); cloud standby live link + the Waitron Cloud boundary                                                                                                      |
| 10  | Tabs / table service         | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324)                                                                                                                                                                                                                                                                                                             | core COMPLETE; owner-added extensions parked                                                                                                                                  |
| 11  | Floor plan                   | FP-1 live floor + FP-2 spatial canvas/editor                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                             |
| 12  | KDS / devices                | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269)                                                                                                                                                                                                                                                                        | routing audit view; a device-scoped collect route                                                                                                       |
| 13  | Tips                         | tip choices on bill payments (card, cash) and on the whole-order screen for a connected reader, enabled in Card payments under Settings; kept off the invoice; sharing and payroll: A793's first design not approved, needs a brainstorm                                                                                                                                                                                                                       | sharing, the Tips page and the pay-period statement (A793); payroll export (integrate-not-build)                                                                              |
| 14  | Bookings                     | Bookings-1, now the `@waitron/bookings` module (#270, #273)                                                                                                                                                                                                                                                                                                                                                                       | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits                                                                                            |
| 15  | Online ordering              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 | not started (later phase)                                                                                                                                                     |
| 16  | Workforce                    | _registro de jornada_ library (chain per node since #268), till clocking and breaks, D2 scheduling, roster authoring + approvals, staff request path + portal; own/manager Hours and PDF/CSV working-time exports | inspector remote access; advisor export checks; wage-computation engine (convenio-gated); D3 payroll export (integrate-not-build)                                         |
| 17 | Accounting export | XLSX period download from Sales & takings: issued invoices, recorded purchases and manual-card payment details | Real accountant import trial before claiming support for a named accounting program |
| 18  | Menu/allergens       | EU-14 allergens, declared directly on the product since #345, product images, venue↔menu membership, extras and options lists end to end (the legacy option groups are gone — Task 13 dropped their tables), per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297); guest-menu allergen and diet symbols open script-free native disclosures | menu schedule (publishing landed, #677); guest menu mobile-data qualification       |
| 19  | Opening hours & channel sync | —                                                                                                                                                                                                                                                                                                                                                                                                                                 | not started (Google Business Profile / Maps)                                                                                                                                  |
| 20  | Procurement & inventory      | received purchase invoices (`@waitron/purchasing`, feeds modelo 303)                                                                                                                                                                                                                                                                                                                                                              | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred                                                                                           |

**Cross-cutting infra:** a joined local spare follows into scratch, and an emergency switch first brings its copy up to date (slice 4b) ·
membership, promotion and rejoin (#197–#272; what is left is under
_Replication, membership & failover — residuals_) · backup and restore (BR-1..BR-4 plus the wizard
and guided Cloud snapshot restore for test venues) · the bucket stream and cold restore (SQLite
slice 2) · SIF topology (`#33`, `node_id` re-key) · the module system (#212–#262; country packs #292)
· the printing subsystem (`@waitron/printing` plus the db-free `@waitron/print-agent`, #282–#335)
· the layout designer and device profiles (#194–#234, #246, #269) · CI and test infra
(scoped CI, pre-push hook, shared-container tests, job-sharding, root scope) · localisation
(per-user `persons.locale`, live language switch, venue-default derivation) · logging and
diagnostics (Slice 1, #192).

---

## The advisor gap — not a build track

**A tax adviser answered [the shortened list](compliance/asesor-questions.md#the-shortened-list-2026-10-09)**
(S1–S16 and the review list R1–R6; S17, on selling by weight, is legal metrology rather than tax)
on 15 November 2026: [what the answers change](compliance/2026-11-15-adviser-answers.md). The
follow-up questions became the [19 November sheet](compliance/2026-11-19-adviser-meeting.md); the answers
written there on 18 November are the owner's own, and the adviser will come back with more details. The Status column below predates both.
Cloud archive and hosting questions, including the historical cloud-storage document's §8a,
are now tracked in the [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md).
Keep core fiscal questions here and coordinate shared assumptions with that review.
Q16 (operating from abroad) remains outside the Spanish rollout's question set under its
Spain-hosting assumption; wider country policy belongs to Cloud.

| Q                                                                                                     | Assumption in the tree                                                                                                                                                                                     | Status                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Q13 (tips outside VAT base)                                                                           | tip lives on `tenders.tip_amount`, never handed to the fiscal backend                                                                                                                                      | **Closed** on primary source                                                                                               |
| Q15 (short payment = descuento)                                                                       | a _descuento_ agreed at/before issuance is outside the base (LIVA 78.Tres.2º)                                                                                                                              | **Closed** on primary source; S5 asks whether a shortfall accepted after the meal is still a discount |
| Q5(a) (one series per till)                                                                           | a series belongs to the server-SIF; two concurrent SIFs need **disjoint** series                                                                                                                           | S16 (restore) and R5; Q5(a)'s two-server case is shelved |
| Q5(c)/(d) (tickets and full invoices in one series)                                                   | A231's branch requires `full` for F1 and F3                                                                                                                                                                | (c) **answered** (art. 7.1.a); R5 may stay in the ticket series (V2884-16); S14 asks F1+F3 and R5+R1–R4 |
| **Q14 (precuenta → amendment log)**                                                                   | a printed pre-bill may oblige an amendment log                                                                                                                                                             | Narrowed: a printed pre-bill must be kept linked to the invoice (A446); S2 asks whether a precuenta counts |
| Q21 (pre-bill, or the invoice when a table asks for the bill)                                         | the table screen prints no pre-bill; when one is built, printing it never fires held food and never marks a line sent (menus plan D10)                                                                     | S1 |
| F3 canje (`IDOtro`, a separate F3 series, `Destinatarios` XSD)                                        | explicit document type and issuer identify foreign recipients; F3 uses `full`                                                                                                                                                   | fields and identity types answered from AEAT's technical rules; R4 |
| Q27–Q29 (paying a bill in parts, a table that leaves without paying, how a comp or discount shows)    | parts: server built (#721), the till does not use it yet; comps and discounts built (#916); leaving without paying built on the owner's decision (B17)                                                     | S3, S6 (A447); S10 **answered** (adviser 1.10) |
| Q31 (correct an issued ticket by differences or by substitution)                                      | `recordCorrection` files by differences (`"I"`); the whole-order cancel credit and A802's part corrections call it                                                                                                              | **Answered**: the business's choice (art. 15.5; AEAT FAQ) |
| Q32 (how a cancelled order's already-issued simplified invoice is undone)                             | the whole-order cancel credits the invoice in full with an R5 corrective invoice, not an annulment (C126)                                                                                                  | S7 |
| Q42 (a bill paid later by transfer: invoice now, or a proforma and the invoice on payment; F1 and F2) | the till's server closes such a bill as a deferred payment, invoice issued at the meal (`POST /api/working-orders/:id/close-deferred`, A275); the open bill's, the presented bill's and the Counter's Pay windows send it (A275 Task 7). The bill payment route accepts cash and card | Option 2 not lawful for a consumer; deposits S8, unpaid debts S6 |

**The laboral advisor** (a _graduado social / gestoría_) has its own list in
[asesor-laboral-questions.md](compliance/asesor-laboral-questions.md). Nothing there blocks the build;
two items want confirming before go-live (the digital-registro RD's status; the provincial convenio
and figures), plus whether the venue's exported working-time record may show per-node chains. The
gestoría's payroll import layout is the one build dependency (it fixes the D3 export format). How card tips are booked (Q49) is question 7 of the [19 November sheet](compliance/2026-11-19-adviser-meeting.md), where the owner's answer of 18 November is "to be confirmed"; the employer-paid tip payroll questions (L6) remain open.

**Data protection (RGPD) is a third track, never scoped end-to-end.** Scope it before engaging a
DPO: a data map (what personal data, where, how long); the controller-versus-processor split and
whether a DPA is needed; the venue-facing duties (privacy notice, lawful basis, access/erasure/
portability, breach notification, retention) and which Waitron must _build_ versus the venue must
_operate_. Blocks nothing today; the retention/erasure/export mechanics become build work once
scoped. A664’s [proposed retention map](superpowers/specs/2026-10-16-a664-data-retention-design.md)
awaits owner and relevant specialist approval under its own gates; the broader privacy programme
remains open. **Scoped 2026-10-22 by A980:** the [data-protection design](superpowers/specs/2026-10-22-a980-data-protection-design.md)
holds the data map, the controller and processor split and the builds-versus-venue list. Its
revision 2 (2026-10-24) records the owner's answers to O1 to O10, and the
[build plan](superpowers/plans/2026-10-24-a980-data-protection-build.md) orders the slices; S4 (sign-in
details deleted at deactivation), S2a1 (the server route for a person's own data download),
S2a2 (its README, the Profile page's Download button and the Users guide section), S1a (the
dashboard setting for the privacy notice page and privacy email), S1a2 (the configuration export
carries the privacy contact, and a production box can be set up from an export again), S1b (the
staff emails, the sign-in page, Account settings and both downloads read the saved privacy page, and
the environment setting is gone) and S1b2 (the invoice email carries the invoice customers' privacy
notice) are built.
The privacy-specialist questions from Q54 on are open. The Cloud half is lane D's D101.

---

## Reference

**Adding a database test to a new package.** Give the suite `useVenueDb` and the migration sets it
needs; it makes its own temporary venue directory. A worker limit remains a per-package choice.
For the older payments observations and one/six-worker recheck, run
`git show edeb8346656cd0690a0155147d4ac358723d278e` (#558).
The other worker pins still need measurement under the reported workspace load.
`packages/db` keeps `maxWorkers: 4`, which CI's
`test-heavy` shards inherit because they pass no worker count of their own. Either way a new package
that copies one of those configs must hold `98/98/98/95` (CLAUDE.md §2) — anything else and
`scripts/coverage-thresholds.test.ts` fails it in `root-guards`.

**Specs still in the tree** (checked against the code 2026-09-27). A spec whose work is built is
deleted once nothing points at it; one stays while a developer doc or code comment points at it, or
while it holds decisions still open.

| Spec                                                                                                                                                                                              | State                                                                                                                                                                      | Open work lives in                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [POS architecture](superpowers/specs/2026-07-18-pos-architecture-design.md)                                                                                                                       | the strategy; §2's sub-projects                                                                                                                                            | _What's built_                                                            |
| [Workforce and time record](superpowers/specs/2026-07-22-workforce-and-time-record-design.md)                                                                                                     | clocking, corrections, Hours and working-time exports built; inspector access, advisor checks and payroll remain                                                                                                                                               | _Working time and staff_: inspector access, advisor checks, payroll and wages                 |
| [Deli hardware](superpowers/specs/2026-07-30-deli-hardware-design.md)                                                                                                                             | partly built; the outage path changed 2026-09-11                                                                                                                           | _Payments and card readers_                                               |
| [Star CloudPRNT](superpowers/specs/2026-08-17-printing-cloud-poll-transport-design.md) and [Epson Server Direct Print](superpowers/specs/2026-08-17-printing-epson-server-direct-print-design.md) | not started beyond the `cloud_poll` columns; low priority                                                                                                                  | _Printers, the print agent and receipts_                                  |
| [Failover printing](superpowers/specs/2026-08-26-failover-printing-design.md)                                                                                                                     | partly built (the job lease, network printers any agent may claim, unprinted kitchen tickets shown on the till, #750)                                                      | _Printers, the print agent and receipts_, _Replication, failover and the cloud_ |
| [Every device enrolled, fail closed](superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md)                                                                                    | partly built; deferred                                                                                                                                                     | The till, devices and table service                                       |
| [Native app capabilities](superpowers/specs/2026-08-30-native-app-capabilities.md)                                                                                                                | reference; nothing committed                                                                                                                                               | the go-native decision                                                    |
| [Logging and diagnostics](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md)                                                                                                  | Slice 1 built (#192)                                                                                                                                                       | _Alerts, logging and diagnostics_                                         |
| [Fiscal certificate distribution](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) and its plan                                                                                   | reverted (#281); describes a removed mechanism                                                                                                                             | _Replication, failover and the cloud_                                     |
| [Handheld app store and kiosk](superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md)                                                                                             | reference; its own-phones decision reversed 2026-09-18                                                                                                                     | —                                                                         |
| [Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)                                                                                          | discussion record; not started                                                                                                                                             | _The box: backups, upgrades and recovery_                                 |
| [SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md)                                                                                               | slices 1–2 and A947 local joining/takeover built and run on two real boxes; Cloud work remains                                                                                                                                   | _Replication, failover and the cloud_                                     |
| [Handheld and till hardware decisions](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)                                                                                      | decisions; the reader dropdown exists                                                                                                                                      | _Payments and card readers_ (Slice 2)                                     |
| [Menus, sections and home layouts](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md)                                                                                      | built (#729 last); owner decisions still open; its home layouts superseded by W93's [Device Home Page design](https://github.com/clintongormley/waitron/blob/f2e5e9fb5976f4c5f63cf1143b9befa22fe2cd12/docs/superpowers/specs/2026-10-05-w93-device-home-page-design.md) | _Menus and the menu_ (_Sales classification and the menus plan — what they left open_) |
| [Service, ordering and billing](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) and its plan                                                                                 | all 18 tasks landed (Task 17 last, #991); what they left open is under The till, devices and table service                                                                 | The till, devices and table service                                       |
| [Bill payments](superpowers/specs/2026-09-26-bill-payments-design.md)                                                                                                                             | server built (#721); the till side built by lane B item B15 (#956)                                                                                                         | The till, devices and table service                                       |

**Dev stack from a worktree.** `wa-wt demo|onboarding <worktree-name>` starts the owner's one stack on
the usual ports, or one of Claude's seven beside it. `wa-wt ls` shows their ports;
`wa-wt reset demo|onboarding <worktree-name>` rebuilds the owner's shared venue (Claude: from the
main checkout only) and `wa-wt reset own demo|onboarding <worktree-name>` rebuilds Claude's own copy.
The rule is in CLAUDE.md §6; detail in
[ui-review.md](ui-review.md) → _Running the stack from a worktree_.

## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §6, _Docs_). In particular:

- **A change that finishes an entry deletes it** — never mark it landed, done, built or merged.
  A point it leaves open that passes the next rule gets a short entry in the same area, titled from
  the point's own words and naming the finished entry's id and PR once ("left open by A231d part 1,
  #1399"). Take the finished piece out of _What to work on next_ and the _What's built_ "Remaining" column
  too, and do not add a receipt paragraph. **This is state, not history; the git log is the
  history.**
- **A loose end found in review is fixed in that pull request, not filed (owner, 2026-11-06).** If
  that really cannot be done, it joins an existing bundle in its area. It gets an entry of its own
  only if a person would notice it, it could cost money or a filing, or it breaks a written rule.
  Everything else stays in the pull request thread. Cost: the list grew by about 25 entries a day,
  about half of them from reviews, and most of those were low value.
- **Related small fixes live in a bundle.** The index gives the bundle one line; each fix's text sits
  under the bundle's `##` heading in the area's file. A change that finishes a fix deletes its text
  there and corrects the count, and the last one deletes the heading and the index line.
- **A decision a comment or doc cites moves to its area's `## Decisions and deliberate limits`
  instead of being deleted, and entries there are never deleted for being finished.**
- **A new entry goes under its area in _Open work, by area_.** One that runs past four lines keeps
  its title, its status and one to three of its own sentences here, with a `[Detail]` link; its
  whole text goes under a `##` heading of the same title in the area's file under
  `docs/backlog/`.
- The moment it goes stale most reliably is a **merge**: `/land-branch` carries a step to update this
  file. A merge deletes the branch the in-flight rows named, so refresh them then.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. If an entry is growing proof-of-work (test counts, grep receipts, "proven by
  deletion", what a review seat caught), that belongs in the PR thread, not here.
