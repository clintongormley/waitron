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

- Send the [curated adviser list](compliance/2026-11-06-adviser-questions.md), once the Spanish is rebuilt from it. It holds up 26 entries,
  seven of them go-live, including 0% VAT and free items on mixed-rate bills.
- [The owner's yes-or-no read: built defaults that wait only for a nod](backlog/till.md#bundle-the-owners-yes-or-no-read-built-defaults-that-wait-only-for-a-nod)
- [One session at the real box: printers, paper, tax QR, the drawer](backlog/printers.md#bundle-one-session-at-the-real-box-printers-paper-tax-qr-the-drawer)
- [One session with real phones and password managers](backlog/dashboard.md#bundle-one-session-with-real-phones-and-password-managers)
- [One owner session with a real certificate against AEAT](backlog/fiscal.md#bundle-one-owner-session-with-a-real-certificate-against-aeat)
- Design with the owner: whether to do A798 slice 9c, since a clock that drifts ahead while the box runs dates sales in a way that cannot be repaired (a start's clock is confirmed first since A1420 PR 1a); and the
  A1323 master key, because A1187 parts 2 and 3 change the same restore steps.

**2. Go-live fixes that can start today.** They add no tables and no lane holds them. Till bundles
run one after another, because they share `apps/till/src/till-app.ts`.

- [A950. Automatic upgrades with rollback](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order): the checked manual path retains a stopped copy, requires a successful disposable-copy sale and offers Restore/Keep. Automation remains in the [upgrade plan](superpowers/plans/2026-11-09-a950-shorter-upgrades.md).

**3. The foundation, already running.** A1308 stays first in lane A, with
[Small checks and indexes that are cheap only inside A1308's fresh tables](backlog/architecture.md#bundle-small-checks-and-indexes-that-are-cheap-only-inside-a1308s-fresh-tables). A1306's history rewrite is A1308's last step (owner, 2026-11-06).

**4. Released by the hold, once A760 lands.** Build order (A446's pre-bill is not scheduled, owner
2026-11-17):
close the day, then A947 and its handover bundles.

- [Close the day: count the cash, record cash in and out, waiter floats](backlog/till.md#bundle-close-the-day-count-the-cash-record-cash-in-and-out-waiter-floats)
- [Series and module-preparation gaps at handover](backlog/replication-cloud.md#bundle-series-and-module-preparation-gaps-at-handover)
- [Finish the clock work: a check at every start and every change](backlog/box.md#bundle-finish-the-clock-work-a-check-at-every-start-and-every-change)
- [Query plans and indexes, measured on a year of data](backlog/architecture.md#bundle-query-plans-and-indexes-measured-on-a-year-of-data)
- [The spare's wait loop: back-off, reasons, stop signals](backlog/replication-cloud.md#bundle-the-spares-wait-loop-back-off-reasons-stop-signals): chart answers and accepted-copy recognition.
- [Remaining setup and failover gaps](backlog/replication-cloud.md#bundle-remaining-setup-and-failover-gaps)
- [Joined-table writers keep their rows right](backlog/till.md#bundle-joined-table-writers-keep-their-rows-right)
- [Everything needing a third box or a Cloud peer](backlog/replication-cloud.md#bundle-everything-needing-a-third-box-or-a-cloud-peer)
- [After A760: A877's one helper first](backlog/service-periods.md#bundle-after-a760-a877s-one-helper-first)
- [One rule for what holds a table back at a reset](backlog/till.md#bundle-one-rule-for-what-holds-a-table-back-at-a-reset)
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
[plan](superpowers/plans/2026-10-08-a430-backlog-open-work-only.md)); each area's italic
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
  Task 8 landed: the producer's name, tax number and postal address are three public settings each official image carries from repository secrets, never committed; a production start refuses without them, and refuses when its chain was made under another producer. The three secrets hold placeholder values for now (owner, 2026-11-08); replacing them (`gh secret set --env-file ~/waitron-campaign-shared/private/producer-identity.env --app actions --repo clintongormley/waitron`) is safe only while no box has started in production, because a production chain refuses a different producer tax number until A993 lands, and every full run's publish job fails while any is missing; once an image carrying a placeholder is published, the publish job also refuses the real tax number unless the repository variable `WAITRON_PRODUCER_CHANGE_ALLOWED` holds it; apart from replacing the placeholder, do not change the tax number until A993 lands; watch the first nightly or manual publish (its load-then-push build had not run on GitHub before). The real-fork test (the plan's 8g Step 5) is still to do. Slice 2 landed (#2820, #2827 and #2836): the text, its renderer, the A4 PDF's renderer, the package's `declaration` command, and `pnpm release prepare` and `pnpm release tag` with their [runbook](operations/release.md). Both release commands refuse until the template's release-blocker line is deleted, when the asesor's answer to Q53 is recorded. Slice 3 landed (#2861, #2874, #2916, #2974; [plan](superpowers/plans/2026-11-11-a940-3-in-app-declaration.md)): every box, in every state and on every listener, answers `/legal/declaration` (and `.pdf`, `.txt`) and `/legal/about`, and says it has no declaration when its image carries none; every terminal opens it: the dashboard's account menu and sign-in screen open About Waitron; on the till, More holds About Waitron just above Log out, and a kitchen screen's corner, the till's sign-in and join screens and the setup wizard have an ⓘ that opens it; the guide's About Waitron page says where to find it. Slice 4 landed (#2987, #3001, #3014; [plan](superpowers/plans/2026-11-12-a940-4-release-image.md)): a `v1.2.3` tag on `main` publishes an image whose records say `1.2.3` and which carries that version's declaration; CI refuses a tag off `main`, a bad version, a missing, blocked or disagreeing declaration, or a version already published; the GitHub Release gets the declaration's PDF and text from the published image; `waitron.sh install v1.2.3` pulls it; a production start on a bundle that is not a release refuses `server.unreleased_build`; a root guard fails when a released declaration changes or its tag is missing. So no box can start in production until `v1.0.0` exists, which waits for Q53. Slice 5 landed (#3051; [plan](superpowers/plans/2026-11-13-a940-5-kept-declarations.md)): a box that starts selling keeps its release's declaration in the venue database, and the declaration page lists each earlier version kept under «Versiones anteriores». Slice 6's library half landed (waitron-io/verifactu#152; [plan](superpowers/plans/2026-11-14-a940-6-library-declaration.md)): from 0.3.0 each `@waitron/verifactu` release carries its own declaration on its GitHub Release and inside the npm package, and AEAT's demand service is removed. Still open: releasing 0.3.0, which waits for the asesor's Q53 answer and for the owner to set `WAITRON_PRODUCER_NAME`, `WAITRON_PRODUCER_TAX_ID`, `WAITRON_PRODUCER_ADDRESS` (secrets) and `DECLARATION_PLACE` (variable) on waitron-io/verifactu; then Waitron moves to `^0.3.0` and `pnpm release prepare` refuses a library with no declaration. 1b (A993) waits until a producer change is scheduled.
  Still needed from outside: the asesor's answer to Q53. The owner's publishable address is settled (supplied 2026-11-04; it travels with the other two).
  [Detail](backlog/fiscal.md#a940-waitrons-declaración-responsable--design-approved-2026-10-22-slice-1-landed-2026-10-23-2000).

- **A993. A change of the system's identity opens a new installation by itself — designed in A940 §5.6, approved 2026-10-22; fiscal, the owner lands it.**
  Built only once a producer change is actually scheduled (owner, 2026-11-11, "Later"); the plan
  is kept unlanded on branch `docs/a993-identity-change-plan`. Until then a production box given
  another producer tax number refuses to start (`sif.producer_changed`). Constraint on its plan (owner, 2026-11-06): a start opens a new installation for a producer difference only when the upgrade's own marker names that same new producer; otherwise it keeps refusing.
  [Detail](backlog/fiscal.md#a993-a-change-of-the-systems-identity-opens-a-new-installation-by-itself--designed-in-a940-56-approved-2026-10-22-fiscal-the-owner-lands-it).

- **One owner session with a real certificate against AEAT** (bundle of 3, 3 important, size S, needs a third party). Holds A1270, A888, A679. [Detail](backlog/fiscal.md#bundle-one-owner-session-with-a-real-certificate-against-aeat)

- **Structured B2B invoices before the applicable 2027 or 2028 date.** Establish the issuer's threshold and recipient scope, then build structured exchange and required reporting. Current paper/email qualification stays separate.
  [Detail](backlog/fiscal.md#structured-b2b-invoices-before-the-applicable-2027-or-2028-date).

- **A445. A free item on a bill with mixed VAT rates should take a share of the price paid.** Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a445-a-free-item-on-a-bill-with-mixed-vat-rates-should-take-a-share-of-the-price-paid).

- **A446. Build the pre-bill: each printed pre-bill is stored as printed and linked to the invoice that follows — NOT SCHEDULED: it stays on the backlog for the foreseeable future (owner, 2026-11-17: "the printed pre-bill, leave it on the backlog for the foreseeable future").** A table's ticket is issued when staff close the table instead (decision D1, MEAL-END-TICKET). The design stays A803 §3.9, kept as written.
  [Detail](backlog/fiscal.md#a446-build-the-pre-bill-each-printed-pre-bill-is-stored-as-printed-and-linked-to-the-invoice-that-follows).

- **A447. A guest's part-payment taken before the table is fully served may need its own advance-payment invoice.** No change until answered.
  [Detail](backlog/fiscal.md#a447-a-guests-part-payment-taken-before-the-table-is-fully-served-may-need-its-own-advance-payment-invoice).

- **A448. Whether a customer's email address alone satisfies TRLGDCU art. 63.3 for an emailed full invoice.**
  [Detail](backlog/fiscal.md#decisions-and-deliberate-limits) _2026-10-12: the product no longer asks for consent at all — A231q's tasks C1a and C1b
  removed it ([plan](superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md)) on the owner's 2026-10-09 answer. Until 2026-10-12 this entry asked
  that the consent request say how the invoice will arrive and how consent is withdrawn._

- **Loose ends left by A230 (`@waitron/verifactu` 0.2.1, #1099).**
  An unusable `TiempoEsperaEnvio` is not recorded anywhere (the raw value is dropped).
  [Detail](backlog/fiscal.md#loose-ends-left-by-a230-waitronverifactu-021-1099)

- **Owner decision 2026-09-24: a void counts on the day it is made, not the day of the sale** —
  The quarterly _modelo 303_ keeps its old behaviour until the asesor answers Q25 (which VAT period a later annulment lands in).
  No till screen or server route calls `recordVoid` yet.
  [Detail](backlog/fiscal.md#owner-decision-2026-09-24-a-void-counts-on-the-day-it-is-made-not-the-day-of-the-sale)

- **One authorised edit of a protected test, plus its neighbours** (bundle of 3, size S, needs the owner). [Detail](backlog/fiscal.md#bundle-one-authorised-edit-of-a-protected-test-plus-its-neighbours)

- **Adviser confirmation: supplier invoice numbers by issue year.**
  [Detail](backlog/fiscal.md#adviser-confirmation-supplier-invoice-numbers-by-issue-year).

- **Reporting — the fiscal remainder (parked)** — left open by the modelo 303 work (#76, #91, #98, #1106).
  [Detail](backlog/fiscal.md#reporting--the-fiscal-remainder-parked)

- **A231/A948. Full invoices at the till** — table bill payments, per-bill unpaid departures and, since #2725, Counter bills paid through the shared Pay window issue F1; direct `POST /api/sales`, `POST /api/pay`, unissued collection, closing a counter bill by transfer and zero-total counter bills still refuse it.
  **Next action:** complete physical paper/QR qualification, the asesor's manual-remedy confirmation and current business-invoice delivery qualification as separate work. The owner removed these as switch prerequisites on 2026-10-27.
  An unpaid departure that issues the invoice of a presented bill loses the table name on it: `issueUnpaidInvoice` saves it only on an open bill (`apps/server/src/working-order.ts`), and neither `settleIssuedOwingNothing` nor the later collection sets it. A deferred-payment close (`closeBillDeferredTx`, `apps/server/src/deferred-close.ts`) now passes it to `settleIssuedOrder` (A275); a bill that leaves owing needs a decision on when to save it.
  [Issuance and remaining limits](backlog/fiscal.md#a231-full-invoices-at-the-till)

- **Show a late success, decide the address, fix those strings** (bundle of 3, 1 important, size S). Holds A554, A557, A558. [Detail](backlog/fiscal.md#bundle-show-a-late-success-decide-the-address-fix-those-strings)

- **A556. A full invoice that later replaces a bill's simplified one would not be delivered through
  the bill.** Nothing issues an F3 today: no route calls `recordSubstitution`.
  [Detail](backlog/fiscal.md#a556-a-full-invoice-that-later-replaces-a-bills-simplified-one-would-not-be-delivered-through-the-bill)

- **A275. Invoice a bill paid later by transfer (full or simplified invoice)** — DESIGN APPROVED; [reviewed plan](superpowers/plans/2026-10-22-a275-final-transfer-close.md) published. Tasks 0–4 and 6 built: the `deferred_closures` table, the close command, its till route and recovery read, and a device-profile action that is off by default ([2026-11-09 plans](superpowers/plans/2026-11-09-a275-transfer-close-command.md), [Task 3 plan](superpowers/plans/2026-11-10-a275-transfer-close-route.md)); receipts, Orders, Find bill's Transactions and the Counter screen name a closed bill Deferred payment, «Pago aplazado» (owner, 2026-11-11; [Task 4 plan](superpowers/plans/2026-11-11-a275-transfer-labels.md)); and the accountant's file (Task 6, [plan](superpowers/plans/2026-11-11-a275-transfer-export.md): its server route, and a button on **Sales & takings** for a session holding `report.export`). Task 5 built: the overview and Sales report show Bills closed and Deferred payment apart from money received ([Task 5 plan](superpowers/plans/2026-11-11-a275-closed-bills.md)). Task 7 is built: the open bill's, the presented bill's and the Counter's Pay windows offer Close as deferred payment ([plan](superpowers/plans/2026-11-11-a275-till-deferred-close.md)). Owner acceptance remains.
  Invoice at the meal, close finally by transfer, preserve sibling/service checks, and export for the accountant; no later receipts or debt.
  The precise H2 writer approval, released clock/Pay contracts and separate F1/delivery/physical gates remain.
  [Design](superpowers/specs/2026-10-22-a275-final-transfer-close-design.md), [detail](backlog/fiscal.md#a275-invoice-a-bill-paid-later-by-transfer-full-or-simplified-invoice--design-now-2026-10-17).

- **W41s. Fiscal prevention and offline recovery.**
  Importing, matching or reconciling recovered history, and any missing-history remedy, wait for
  the adviser's answer to Q41. Signed witnesses and fencing (W41s-10b)
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

- **Allocated standby adoption still needs the primary's venue copy and fresh establishment
  authority.** Complete the copy and authenticated establishment path before presenting a successful fiscal
  join. The pending file alone supplies no live authority.
  [detail](backlog/fiscal.md#w41s-4-adoption-boundary-checkpoint-2026-10-14).

- **Settle the hold and the brake once** (bundle of 2, 2 important, size S, needs the adviser). [Detail](backlog/fiscal.md#bundle-settle-the-hold-and-the-brake-once)

- **The reconcile sweep may raise a second "accepted with errors" warning.**
  [Detail](backlog/fiscal.md#the-reconcile-sweep-may-raise-a-second-accepted-with-errors-warning).

- **Loose ends left by C126 (cancelling an order whose invoice was issued credits it, #1030).**
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **The next adviser batch awaits the owner's decisions, then sending.** The [curated English list](compliance/2026-11-06-adviser-questions.md) replaces the Spanish draft, which covered the additions after the shortened list and the labour questions. Adviser answers, including Q19, remain open. The owner records the earlier shortened list as sent around 15 October; do not send its questions again as a new batch.
  [Detail](backlog/fiscal.md#asesor-questions-to-send)

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

- **VAT at line add (M7v, A68).** — left open by the menus plan. Asesor Q26 (the rate on the day of
  issue) is open. The till computes a basket VAT split (`vatBreakdown`,
  `apps/till/src/state/working-order.ts`) that no screen shows.
  [Detail](backlog/fiscal.md#vat-at-line-add-m7v-a68)

- **Correcting a paid invoice: dish counts, earlier refunds and cancelled dishes (left open by
  A802 slice 5b, #3108).** The correction window ticks whole dishes; an earlier ordinary refund does not
  count towards a correction; a refund of cancelled dishes does not yet file its corrective in the
  same step (A758 §3.8, owner Q43 e).
  [Detail](backlog/fiscal.md#correcting-a-paid-invoice-what-a802-left-open)

- **A corrections report for earlier quarters' VAT** (owner, D6 and D12, 2026-11-16). A filed
  quarter never changes; every later correction of an earlier quarter's invoice goes on a separate
  report for the accountant instead of into the current quarter. Waits on the adviser's answer to
  question 7 on 19 November. Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a-corrections-report-for-earlier-quarters-vat-was-correct-vat-without-returning-money)

- **Probe a replacement R5 "S", and an R4 "S", on AEAT's test service (go-live; watcher, 2026-11-14 18:22; the R4 "S", watcher, 2026-11-15 01:52).** Run
  before the first real R5 'S': a simplified invoice refused for a future date (`1112`), then a
  replacement R5 "S" naming it with rectified amounts 0.00 / 0.00, sent while the original's date is
  still in the future and again after it has passed; and an R4 "S" replacing a full invoice refused
  the same way, naming the same customer. It needs a new `live-aeat` mode in the
  `verifactu` repo, which needs the owner's approval, by A985's precedent. Left open by Q37-FIX.
  Turning on full-invoice replacement (`FULL_INVOICE_REPLACEMENT_ON`, A1407) waits for this probe
  and for the answer to adviser question S14 (one corrective series for R4 and R5?): answer it
  before the first real R4 is filed, since an R4 is numbered from the same corrective series as R5.

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live filing.**
  The advisor is asked only to confirm (review item [R3](compliance/asesor-questions.md#the-shortened-list-2026-10-09)).
  **Non-blocking while pre-production; blocking before going live.**
  [Detail](backlog/fiscal.md#no-tax-0-is-an-open-fiscal-question-and-it-must-be-answered-before-the-first-live-filing)

- **Rename the `hour-*` names to minute names** — left by A947 slice 4a.
  Before go-live it needs no compatibility code: until then any installation may be reset (CLAUDE.md §3).
  [Detail](backlog/fiscal.md#rename-the-hour--names-to-minute-names).

- **Should `packages/fiscal-verifactu` have a mutation floor?**
  [Detail](backlog/fiscal.md#should-packagesfiscal-verifactu-have-a-mutation-floor).

- **Should a cancelled or replaced invoice's copy say so?** Left open by A1411 (the tax office's Invoices page and month download). A question for the adviser on 19 Nov beside T4. If the adviser answers no on T4, remote access is needed on top. [Plan](superpowers/plans/2026-11-16-a1411-tax-office-invoices.md).

### The setup wizard, onboarding and the demo venue

- **Recovery operations still buffer whole database files.** First-setup repair snapshots retain
  their 128 MiB budget, and Start again's deletion fingerprints also read whole database files.
  Replace these buffers with file-based processing while preserving their
  exact-content checks. Ordinary first-setup admission no longer uses these snapshots.
  The unused archive-preparation route and emergency handover still buffer uploads within 256 MiB.
  Configuration imports keep their separate buffer.
  [Detail](backlog/setup.md#recovery-operations-still-buffer-whole-database-files).

- **Qualify year-sized Cloud backups and revisit incremental copies with venue measurements.**
  Pair the box and Cloud release candidates on a year-sized backup and near-cap publication.
  Measure the deployed verifier's resource use on the representative capture.
  Revisit continuous Cloud copies, content-named pieces and a read-only archive database after
  time-ordered IDs and real venue measurements.
  [Detail](backlog/setup.md#qualify-year-sized-cloud-backups-and-revisit-incremental-copies-with-venue-measurements).

- **A1186. The setup tour offers Waitron Cloud's level-2 trial (owner, 2026-10-29).**
  **Build remains open**; Cloud's qualified trial journey is prerequisite G1 in the plan.
  Stays in the backlog, in no lane, until Cloud's sign-up and trial pages and a real box-to-Cloud connection exist (owner, 2026-11-09).
  [Detail](backlog/setup.md#a1186-the-setup-tour-offers-waitron-clouds-level-2-trial-owner-2026-10-29).

- **A1215. Correcting invoices issued under a wrong clock** (from A1207): a box can hold invoices
  dated after the real time (a restored backup from a box whose clock was fast). Nothing in Waitron
  corrects them, and what to do about them with AEAT is undesigned. Design first.

- **A1089: setup and backup recovery must distinguish waiting from missing capability.** Separate absent callbacks/services and incompatible or refused retained artifacts from temporary work; offer a supported source, image or recovery choice and any required sign-in there.
  [Audit](backlog/self-service-refusals.md#setup-readiness).

- **A1089: an incomplete-join reset needs an outcome after a failed restart.** Retain authenticated reset proof and add a supported way to retry or restart if the half-join remains.
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
  open by A1099; needs an owner decision.
  [Audit](backlog/self-service-refusals.md#a1161-with-the-database-present-a-public-record-or-documents-file-still-dead-ends-start-again).

_Formerly A2 and B1._ Detail: [backlog/setup.md](backlog/setup.md).

- **A dev stack cannot finish a Live setup**: it stops at the readiness step, which needs a second
  clock nothing on a dev stack can be; the owner chose to let development mode take the box's own
  clock (2026-11-17), not built yet.
  [Detail](backlog/setup.md#a-dev-stack-cannot-finish-a-live-setup)

- **Loose ends left by A496 (moving to a new tax ID).**
  [Detail](backlog/setup.md#loose-ends-left-by-a496-moving-to-a-new-tax-id)

- **`restoreFromArtifact` has no production caller.** Only tests call it since A1131bc slice 4;
  decide whether they should place archives through `runStagedRestore`, then delete it.
  [Detail](backlog/setup.md#restorefromartifact-has-no-production-caller)

- **OWNER DECISION, open since #443: should the setup wizard still OFFER "Add a mirror node"?**
  Since 3b-F a test on two separate databases joins a spare that then takes over, by a handover and
  by an emergency switch; no joined spare's takeover has run on two started servers, so an operator
  who adds one still spends a box on a standby no real box has tried. Removing or disabling the
  option is a product call, not a wording one.
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

- **A237. Nothing guards the hint-or-"?" rule across screens (owner 2026-10-03)** — OPEN.

- **Starter courses for Italy.** When its country pack is built, add the four courses and settle
  their firing defaults. [Detail](backlog/setup.md#starter-courses-for-italy)

- **A guided tutorial for Demo and Preparation (A250, owner 2026-10-03)** — OPEN, partly designed,
  not to be built yet (owner: "we just mustn't forget it"); needs a spec before queueing.
  [Detail](backlog/setup.md#a-guided-tutorial-for-demo-and-preparation-a250-owner-2026-10-03)

### Menus and the menu

- **Loose ends left by A322 (#1372, an included menu can show its sections directly).** Folder photos,
  shortcut placement and fixed values remain open.
  [Detail](backlog/menu.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open)

- **A very long number is cut off in an extras list form.** [Detail](backlog/menu.md#what-1151-left-open-2026-10-03)

- **A1523. A cover charge, and dearer seats on the terrace (owner, 2026-11-14).** Not supported
  today. A cover charge applies only to orders eaten in (A1522's setting). The only way to charge
  more on the terrace today is to make it a department of its own with its own menu. Not designed.

- **A1517. Accepted allergen changes before go-live (owner, 2026-11-11): go-live.** The owner accepted
  the recommendations; mobile-data access to A670's published menu remains to build.
  The [cleared new-selection plan](superpowers/plans/2026-11-12-a1517-2-allergen-choices.md) leaves option-list labels unfiltered because they carry no allergen data.
  [Proposal](superpowers/specs/2026-11-11-a1517-allergen-proposal.md) · [Detail](backlog/menu.md#a1517-allergen-points-to-revisit-before-go-live)

- **Menu prices' narrow-layout CI failure still needs a cause (A613).**
  [Detail](backlog/ci.md#menu-prices-narrow-layout-ci-failure-still-needs-a-cause-a613)

- **Tabs selected visible** (bundle of 1, size S, needs the owner). [Detail](backlog/menu.md#bundle-tabs-selected-visible)

- **A670 — read-only online menu, then fixed A4 presets (owner decisions, 2026-11-13).**
  Serve read-only guests from Cloud’s last delivered published copy; live forwarding stays with ordering.
  Customer names fall back through guest language, venue default, then internal name; never kitchen.
  Managers can preview a published menu in guest languages and enable local sharing of the default publication. The watcher cleared the
  [build plan](superpowers/plans/2026-11-13-a670-guest-menu-build.md), including browser Print / Save as PDF.
  Fixed A4 presets offer browser Print / Save as PDF. The box delivers the published copy to Cloud and reports confirmation; mobile-data qualification remains. No ordering.
  [Detail](backlog/menu.md#a670--guest-menu-sharing-and-fixed-a4-presets)

- **wt-data-table: heading wrap, long names, odds and ends** (bundle of 4, size M). [Detail](backlog/menu.md#bundle-wt-data-table-heading-wrap-long-names-odds-and-ends)

- **Smaller things #379 surfaced and did not take.** The price input and modifier rules.
  [Detail](backlog/menu.md#smaller-things-379-surfaced-and-did-not-take)

- **Translation report excludes image names (C122, #1006).** The media module's
  `contentTranslations` seat supplies only a kind and an id. Showing a name or editor link needs
  a separate seat design that respects module boundaries; no change is queued.

- **The media library still reads every matching image for search and name sorting, inside the venue
  write lock** — further optimisation waits for a material measured sale delay; the watcher
  chose no split after the 2,000-image Mac probe (2026-11-16).
  [Detail](backlog/menu.md#the-media-library-still-reads-every-matching-image-for-search-and-name-sorting-inside-the-venue-write-lock)

- **Two price rules disagree about a value that is not negative** — OPEN (found 2026-09-21, task
  N4).
  [Detail](backlog/menu.md#two-price-rules-disagree-about-a-value-that-is-not-negative)

- **Menu home preview rendering** (size M). [Detail](backlog/menu.md#menu-home-preview-rendering)

- **After A760 moves the bundle format: An import checks rows as a save does** (bundle of 5, size S). Holds A1074. [Detail](backlog/menu.md#bundle-after-a760-moves-the-bundle-format-an-import-checks-rows-as-a-save-does)

- **Translate all: notice, release and Cloud followups** (bundle of 3, size M). [Detail](backlog/menu.md#bundle-translate-all-followups)

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

- **Loose ends left by A343 (a menu's Price overrides tab tidied, #1368).** The Price overrides
  tab's save message comes after the whole table in tab order, so a keyboard user cannot reach Undo
  from a field within its 5 seconds (decided as built, not tested with a user).
  [Detail](backlog/menu.md#loose-ends-left-by-a343-a-menus-price-overrides-tab-tidied-1368)

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version** —
  owner, 2026-10-07; PR 1 landed (#2510), PRs 2–5 not started: the owner put them back on the
  backlog on 2026-11-09 ("it can go on the backlog"). PR 1 gave Undo for a menu's name, Home display,
  own section's name, photo or colour, and a dish's or one variant's price here, plus edit links
  on shared and included changes. Left for later (PRs 2–5): includes, products, sections, order and shortcuts.
  [Detail](backlog/menu.md#a353--previews-changes-an-undo-link-that-puts-one-change-back-to-the-live-version)

- **A1377 — A353's Undo: two wordings for the owner** — a deleted menu's price Undo, and a
  success line with two colons.
  [Detail](backlog/menu.md#a1377--a353s-undo-two-wordings-for-the-owner)

- **A1373 — The Preview credits a product's own price change seen through an include to the
  included menu**, not the shared product, when no menu sets a price of its own; telling it apart
  from an included menu clearing its price needs the published menu document to record where each
  live price came from.
  [Detail](backlog/menu.md#a1373--the-preview-credits-a-products-own-price-change-seen-through-an-include-to-the-included-menu)

- **One kind of unit refusal on the price field reads "The server rejected this value…"**, which
  after a price message reads as the price; a unit-specific sentence needs the owner's wording
  (left open by #1188's review, W66).

- **From #541's review, neither blocking:** the product list shows a variant's blank price as its
  parent's with no marking (`apps/dashboard/src/widgets/product-list.ts`) — whether to grey it is
  the owner's call. [Detail](backlog/menu.md#from-541s-review-neither-blocking)

- **Dishes sold by measure and their extras** (bundle of 1, needs the owner). [Detail](backlog/menu.md#bundle-dishes-sold-by-measure-and-their-extras)

- **The extras form cannot pick a variant**, though the menu accepts one as an extras item
  (owner decision 2026-09-24): its picker lists top-level products only (`listProducts`). **Next
  action:** decide whether the picker should list variants.

- **Each unit literal** (bundle of 1, size S). [Detail](backlog/menu.md#bundle-each-unit-literal)

- **The combined end-to-end journey has not been walked**
  [Detail](backlog/menu.md#the-combined-end-to-end-journey-has-not-been-walked)

- **The picker collapses on `focusout` alone** (`#finishEditing`). If the editor is reported
  snapping shut mid-selection, make the collapse depend on `relatedTarget`.



### Service periods, opening hours and departments

- **A1512. Send the venue's opening hours to Google (owner, 2026-11-11; was SP19).** Wanted. The
  hours and closures kept in Waitron update the venue's Google Business Profile, so Google Maps never
  shows a closed venue as open. Needs a design. Not started.

- **After A760: A877's one helper first** (bundle of 4, 1 important, size L, waits for another entry). [Detail](backlog/service-periods.md#bundle-after-a760-a877s-one-helper-first)

- **Try the Calendar's long press on real Android and iOS phones (A720).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a720)


- **Which name a record sent across a legal-name change carries** (A494 follow-up, 2026-10-11). A
  record keeps the name it was written with, so one written before the change but sent after it
  carries the old name, and a later cancellation of an earlier invoice carries the new one. Waits
  on the asesor's answer to Q37(d), S18 in `docs/compliance/asesor-questions.md`.

- **A1084. A confirmed late dish routes by the period running when it is sent, not the period the
  kitchen agreed for**
  [Detail](backlog/service-periods.md#a1084-a-confirmed-late-dish-routes-by-the-period-running-when-it-is-sent-not-the-period-the-kitchen-agreed-for)

- **Two date helpers read years 0 to 99 as 1900 to 1999**
  [Detail](backlog/service-periods.md#two-date-helpers-read-years-0-to-99-as-1900-to-1999)

- **Refresh service settings on an open till**
  [Detail](backlog/service-periods.md#refresh-service-settings-on-an-open-till)

- **Split an order's recorded service mode into two facts (owner, 2026-10-09) — future work.**
  [Detail](backlog/service-periods.md#split-an-orders-recorded-service-mode-into-two-facts)

- **Smaller notes from the Hours reviews** — left open by the reviews of A261 step 5 (Hours, #1298):
  repeated-midnight clock choices still need checking.
  [Detail](backlog/service-periods.md#smaller-notes-from-the-hours-reviews)

### The kitchen and preparation

_Formerly the kitchen entries in the opening part of the old Track A (before A1), and kitchen entries elsewhere; part of A9._ Detail: [backlog/kitchen.md](backlog/kitchen.md).

- **Held paper followups** (1 entry, size M). [Detail](backlog/kitchen.md#bundle-held-paper-followups)

- **Supervisor station read** (bundle of 2, size S, needs the owner). Holds A1079. [Detail](backlog/kitchen.md#bundle-supervisor-station-read)

- **Loose ends left by service Task 5 (#750): printer policy, dish units, group and station
  records, and screen refresh.**
  [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)

- **A venue's second station does not start on the pass printer.** **Add a station** starts with the
  printers every station uses only once there are two or more stations, so a manager has to choose
  **Put on every station** again after adding the second; a station without the pass printer drops
  its dishes from the pass ticket. Left open by A366 slice 5 Part B (decision P2), #3723.

- **KDS corrections deferred from #191** — owner, 2026-09-01.
  [Detail](backlog/kitchen.md#kds-corrections-deferred-from-191)

- **Mark a new dish as urgent** — owner, 2026-09-27.
  [Detail](backlog/kitchen.md#mark-a-new-dish-as-urgent)

- **Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it).** —
  left open by the menus plan.
  [Detail](backlog/kitchen.md#changing-sent-lines-and-the-kitchen-screen-task-7c-710-and-the-kitchen-fixes-after-it)

- **A1139 — A kitchen card in Ready keeps ageing (2026-10-27; open, owner question).**
  Should a Ready card stop ageing, age from when it became Ready, or is it enough that a cook can
  collapse Ready to a strip that draws no cards (slice 9)? [Detail](backlog/kitchen.md#a1139--a-kitchen-card-in-ready-keeps-ageing-2026-10-27-open-owner-question)

- **A move made from the old station's own screen still gives that station a "moved" notice, and a
  correction slip where its ticket printed** — `moveDishesToStation`
  (`apps/server/src/station-move.ts`) does so whoever moved it. Should it? A question for the owner.
  Left open by A439.

- **A692 — Editing a sent dish decides its extras' "made here" again, by the device that edits
  (2026-10-15; open, owner decision).**
  [Detail](backlog/kitchen.md#a692--editing-a-sent-dish-decides-its-extras-made-here-again-by-the-device-that-edits)

### The till, devices and table service

- **Service steps after a bill moves** (bundle of 1, size S). Holds A1333. [Detail](backlog/till.md#bundle-service-steps-after-a-bill-moves)

- **Small till and floor wording fixes** (bundle of 5, size M, 4 wait for the owner's table-screen redesign). Holds A470, A1106, A1107, A1108. [Detail](backlog/till.md#bundle-small-till-and-floor-wording-fixes)

- **A1421. The Downstairs map drawn tiny at phone width.** Seen once, not investigated.
  [Detail](backlog/till.md#a1421-the-downstairs-map-drawn-tiny-at-phone-width)

- **The till top bar fits at phone width, 1024 and 1280** (bundle of 7, 1 important, size M). Holds A1082, A921, A1219. [Detail](backlog/till.md#bundle-the-till-top-bar-fits-at-phone-width-1024-and-1280)

- **The owner's yes-or-no read: built defaults that wait only for a nod** (bundle, 2 important, size M, needs the owner). Holds A723, A762, A1059, A1060, A1063, A1067, A1068, A1080, A1081, A1250, A1253, A893, A936, A900, A923, A1011, A1020 (remaining words and choices), A1031, A924, A925, A952, A953, A954, A956, A957, A958, A959, A292, A856, A859, A841, A841, A841. [Detail](backlog/till.md#bundle-the-owners-yes-or-no-read-built-defaults-that-wait-only-for-a-nod)


- **A803. Bills and tables: one portion per order line, one bill switcher, one picker (owner,
  2026-10-18).** Owner-approved design; A773-1 has landed. Slice 4c, Split a table through the same
  picker, has landed; it leaves open A1349 and A1359. Remaining: pre-bills through A446, not scheduled for
  the foreseeable future (owner, 2026-11-17).
  [Detail](backlog/till.md#a803-bills-and-tables-one-portion-per-order-line-one-bill-switcher-one-picker)


- **Take over offered where it is needed** (bundle of 2, size M). Holds A1349, A1289. [Detail](backlog/till.md#bundle-take-over-offered-where-it-is-needed)


- **Table screen panels that do not fit** (bundle of 3, size S). Holds A1359, A1265, A1290. [Detail](backlog/till.md#bundle-table-screen-panels-that-do-not-fit)

- **One answer to "where is this order"** (bundle of 3, size S, needs the owner). Holds A1235, A1032, A678. [Detail](backlog/till.md#bundle-one-answer-to-where-is-this-order)

- **A1261. A full invoice for a bill already paid, from the table's ⋮ (left open by A803 slice 3,
  Owner question 2, #2360).** Correct invoice (A802) does not issue a full invoice; offer one
  from the ⋮ for a paid bill once something does.
  [Detail](backlog/till.md#a1261-a-full-invoice-for-a-bill-already-paid-from-the-tables-)

- **Other till sentences still send the person to somebody else, against the refusal rule (left
  open by A1382, #3605 and #3604; fiscal and invoice wording remains).** Listed by code in the detail.
  [Detail](backlog/till.md#other-till-sentences-still-send-the-person-to-somebody-else-against-the-refusal-rule)

- **A1287. With no party, the ⋮'s Merge bills does nothing (left open by A803 slice 4a, D15).**
  Decide whether Merge bills goes too.
  [Detail](backlog/till.md#a1287-with-no-party-the-s-merge-bills-does-nothing)

- **One count of items everywhere** (bundle of 1, size M). Holds A997. [Detail](backlog/till.md#bundle-one-count-of-items-everywhere)

- **What a row action takes on a grouped row** (bundle of 3, size M, needs the owner). Holds A1193, A1194, A1198. [Detail](backlog/till.md#bundle-what-a-row-action-takes-on-a-grouped-row)

- **Retire the old grouped-line writer** (bundle of 1, size S). Holds A1197. [Detail](backlog/till.md#bundle-retire-the-old-grouped-line-writer)

- **A937. Measure the owner's real floor plan once it is drawn (left open by A757 slice 5).** Slice
  5's size check ran on Santet's invented grid, where Terrace's tables show names but no cue; re-run
  it on the owner's floor. [Detail](backlog/till.md#a937-measure-the-owners-real-floor-plan-once-it-is-drawn)

- **A1033. A full invoice's later copies change their guests line when a bill moves to the counter
  (left open by A758-7).** A simplified receipt keeps the count stored at payment.
  [Detail](backlog/till.md#a1033-a-full-invoices-later-copies-change-their-guests-line-when-a-bill-moves-to-the-counter-left-open-by-a758-7)

- **What an open till picks up from a setup change** (bundle of 1, size S). Holds A787. [Detail](backlog/till.md#bundle-what-an-open-till-picks-up-from-a-setup-change)

- **An element inside a shadow root attached after a drag starts keeps its own cursor rule during
  that drag** — left open by A642.
  [Detail](backlog/till.md#an-element-inside-a-shadow-root-attached-after-a-drag-starts-keeps-its-own-cursor-rule-during-that-drag)

- **The "Goes with" line** (bundle of 1, size S). [Detail](backlog/till.md#bundle-the-goes-with-line)

- **Status words on the pass and beside it** (bundle of 2, size S). [Detail](backlog/till.md#bundle-status-words-on-the-pass-and-beside-it)

- **Segmented choices still break words when whole words cannot fit (left by A773-2 B4b).** Decide
  whether such a control should stack its choices instead.
  [Detail](backlog/till.md#segmented-choices-still-break-words-when-whole-words-cannot-fit-left-by-a773-2-b4b)

- **Custom item on the Counter (A738 residual; undecided).** The dashed + Custom item tile and its
  window remain unbuilt. The window needs a name, price, required VAT rate and destination
  (nowhere or a station). Decide the permission and whether an underlying product supplies the
  menu, reports and invoice-line identity before building an arbitrary-price path.
  [Detail](backlog/till.md#custom-item-on-the-counter-a738-residual)

- **A559. The till's full-invoice dialog changes width when an error appears.** Left open by A231q.
  [Detail](backlog/till.md#a559-the-tills-full-invoice-dialog-changes-width-when-an-error-appears)

_Formerly A4; part of A9._ Detail: [backlog/till.md](backlog/till.md).

- **Loose ends left by the comments sweep (#613–#623).** Found while pruning comments.
  - Split-off checks may reach the same path as a held-order edit that changes sent lines (#623).
    Nothing tests two `openTab` calls racing on one table or concurrent rounds landing on
    consecutive line numbers (the sequential versions are in `tabs.test.ts`).
    [Detail](backlog/till.md#split-off-checks-may-reach-the-same-path-as-a-held-order-edit-that-changes-sent-lines)
  - Should the `no-meat`/`no-fish` lenses also hide a dish whose diet is still pending review, as
    `vegan`/`vegetarian` do? (#621)
    [Detail](backlog/till.md#should-the-no-meatno-fish-lenses-also-hide-a-dish-whose-diet-is-still-pending-review)
  - Till widget points from #616 that were read but not run (`apps/till/src/widgets`).
    [Detail](backlog/till.md#till-widget-points-from-616-that-were-read-but-not-run)
  - The table-order screen's `#lineGross` comment was not restored (#614).
    [Detail](backlog/till.md#the-table-order-screens-linegross-comment-was-not-restored)

- **Cash handed back for a voided cash sale is recorded nowhere** — OPEN (found 2026-09-24 by #605).
  A void writes no payment or refund row, so if staff give a customer cash back, the void's day
  shows a drawer shortfall at cash-up. **Owner decision 2026-09-25:** keep it here and decide it
  when the till's void screen is designed.
  [Detail](backlog/till.md#cash-handed-back-for-a-voided-cash-sale-is-recorded-nowhere)

- **One rule for a booking when the evening's layout changes** (bundle of 2, size S, needs the owner). Holds A550, A857. [Detail](backlog/till.md#bundle-one-rule-for-a-booking-when-the-evenings-layout-changes)

- **A474 — today's floor changes on the till: follow-ups (2026-10-11).** The map's drag works out
  its target the slow way, and smaller gaps. Left open by A429 slice 4 (#1526).
  [Detail](backlog/till.md#a474--todays-floor-changes-on-the-till-follow-ups)

- **Show a table's short name where the full name does not fit** (bundle of 4, 3 important, size S, needs the owner). Holds A561, A562, A1101. [Detail](backlog/till.md#bundle-show-a-tables-short-name-where-the-full-name-does-not-fit)

- **Joined-table writers keep their rows right** (bundle of 1, size M, waits for another entry). Holds A594. [Detail](backlog/till.md#bundle-joined-table-writers-keep-their-rows-right)

- **One rule for what holds a table back at a reset** (bundle of 3, 1 important, size M, waits for another entry). Holds A565, A566, A860. [Detail](backlog/till.md#bundle-one-rule-for-what-holds-a-table-back-at-a-reset)

- **A turned floor plan table narrower than its unturned box stops short of the plan's left or top
  edge.** An 8 × 4 turned 90° stops 2 squares from the left edge, because its saved corner cannot
  go below 0. Owner question asked 2026-10-16; (a), keeping it so, is built. Left open by A672.
  [Detail](backlog/till.md#a-turned-floor-plan-table-narrower-than-its-unturned-box-stops-short-of-the-plans-left-or-top-edge)

- **Other till surfaces have not been checked against the forms rule.** The payment and weighing
  steps, the dish options picker and the supervisor override dialog hold their buttons before any
  press; whether a number pad or a choice picker counts as a form is open. Left open by C47.
  [Detail](backlog/till.md#other-till-surfaces-have-not-been-checked-against-the-forms-rule)

- **Guest-facing QR, online ordering, delivery, online booking** (bundle of 4, size L, waits for another entry). Holds A508, A509, A1012, A1013. [Detail](backlog/till.md#bundle-guest-facing-qr-online-ordering-delivery-online-booking)

- **A1513. Take orders from the delivery apps: Glovo, Uber Eats, Just Eat (owner, 2026-11-11).**
  After go-live, not at it. Today staff would type each app order into the till by hand. Needs a
  design, including whether to connect each app or one service that gathers them all. Not started.
  A delivery-app order is always taken away.

- **A1514. Share bookings with TheFork and Reserve with Google (owner, 2026-11-11).** Later: Waitron's
  own booking system, including online booking (A1013), works first. Without it, a venue taking
  bookings in both places can double-book a table. Not started.

- **Loose ends left by A429 slice 1 (#1493).**
  Two small floor-plan refusals.
  [Detail](backlog/till.md#loose-ends-left-by-a429-slice-1-1493)

- **One measuring pass over the till at 390 and 1024** (1 entry remains for the owner's floor-map redesign; header observations stay with the top-bar bundle). [Detail](backlog/till.md#bundle-one-measuring-pass-over-the-till-at-390-and-1024)

- **A436 — a kitchen display with someone signed in, logged out only after a long idle time** (owner,
  2026-10-08, answering the A366 slice 5 plan; open). The owner: "kitchen
  displays can have a login, but i would not expect them to log off automatically, or at least
  only after an extended logout time (eg 30 minutes)". Today nobody can sign in on one. Left out
  of slice 5 as too large for it.
  [Detail](backlog/till.md#a436--a-kitchen-display-with-someone-signed-in-logged-out-only-after-a-long-idle-time)

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group).**
  - Each new group Ready command moves the party's revision, so a waiter's open table screen meets
    `party.out_of_date` after it and reads again.

- **Loose ends left by service Task 11 (#916, cancellations, comps and discounts; B11a–B11g).**
  The adjustment history records who approved, but not whether the bill's comp limit or the refund rule,
  rather than the reason, is why.
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **Loose ends left by service Task 16 (#981, counter handover).**
  Till-profile defaults, a spare gap in the table-order bottom bar, the dashboard menu over alerts.
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **Loose ends left by service Task 17 (#991, a bill left unpaid).**
  Collecting PART of the debt later is not built. Collecting it in full uses
  `POST /api/working-orders/:id/collect`.
  [Detail](backlog/till.md#task-17-991-a-bill-left-unpaid)

- **Add a device: loose ends from A268** (bundle of 1, size S). [Detail](backlog/till.md#bundle-add-a-device-loose-ends-from-a268)

- **Loose ends left by the table actions plan (Tasks 8, 10 and 11, #869, #875, #881; C77/C86;
  C84).**
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

- **Nothing covers the order screen's bar** (bundle of 1, size S, needs the owner). Holds A1211. [Detail](backlog/till.md#bundle-nothing-covers-the-order-screens-bar)

- **Close the day: count the cash, record cash in and out, waiter floats** (bundle of 3, 2 go-live, 1 important, size L, design approved 2026-11-06, waits for A1308's payment and refund slices). Holds A1325. [Detail](backlog/till.md#bundle-close-the-day-count-the-cash-record-cash-in-and-out-waiter-floats)

- **The till's four choice dialogs (`apps/till/src/widgets/`) each carry their own radio-option
  styles, which could be one shared set** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.

- **Loose ends left by W97 (#1311).**
  - A disabled device's profile approvals come back when a join enables it again (unchecked
    whether that is wanted).
  - The profile editor also reads people, so it needs `person.manage` beside
    `venue.configure`; no role holds only the latter today.
    [Detail](backlog/till.md#the-profile-editor-reads-people-and-the-venues-departments-and-zones)
  - `apps/dashboard/src/screens/device-profiles-screen.ts` is over 1,600 lines; "Where it serves"
    and "Who can sign in" could become widgets of their own.


- **WebKit in CI for A841's start-up checks (lane A ruling, 2026-10-21).** Whether WebKit's Linux
  libraries are missing from `ubuntu-latest` is an assumption to check first.
  [Detail](backlog/till.md#webkit-in-ci-for-a841s-start-up-checks-lane-a-ruling-2026-10-21)

- **Uploaded font files for themes (owner, 2026-10-20, A841 Q7 B) — after A841.** A theme's Typeface
  may also be a font file the venue uploads, so every screen draws the bar's own face.
  [Detail](backlog/till.md#uploaded-font-files-for-themes-owner-2026-10-20-a841-q7-b--after-a841)

- **Refresh the floor without a staff action in a zone's list view — OPEN (3d, W16).** — left
  open by the product folders work. Since A429 slice 3 the floor screen re-reads the floor every
  15 seconds while a zone's map is on screen. Polling would read `listTablesWithState` every few
  seconds on every till; choose the interval and cost first.
  [Detail](backlog/till.md#refresh-the-floor-without-a-staff-action-in-a-zones-list-view--open-3d-w16)

- **The till's menu reads (Task 7, #719).** — left open by the menus plan. Every menu poll waits
  its turn in the write queue, and a till learns of a menu change only by polling, because the
  dashboard's live-update route accepts the management cookie only.
  [Detail](backlog/till.md#the-tills-menu-reads-task-7-719)

- **The till's home page (Task 9, #729).** — left open by the menus plan. Every menu read from an
  enrolled device also reads the device and the till's setup.
  [Detail](backlog/till.md#the-tills-home-page-task-9-729)

### Printers, the print agent and receipts

_Formerly A3, A8 and B6; part of A9._ Detail: [backlog/printers.md](backlog/printers.md).

- **A print agent somewhere other than the box** (bundle of 4, size L, waits for another entry). Holds A1203, A1204, A1175. [Detail](backlog/printers.md#bundle-a-print-agent-somewhere-other-than-the-box)

- **One session at the real box: printers, paper, tax QR, the drawer** (size M, needs the real hardware and inbox). Holds A739, A773, A552, A553. [Detail](backlog/printers.md#bundle-one-session-at-the-real-box-printers-paper-tax-qr-the-drawer)

- **Measure one-job print pulls on the box.** Physical throughput, authentication and large retained queues remain unmeasured. [Detail](backlog/printers.md#measure-one-job-print-pulls-on-the-box)

- **Cross-box print-agent TLS** — an agent trusts only its local box CA, so a mirror's agent cannot
  reach the primary; gates the mirror's print agent (_Afterwards_). The vouch slots into the same
  route later.

- **Waitron carries two QR encoders; consolidate on `qrcode-generator`** — Small.
  [Detail](backlog/printers.md#waitron-carries-two-qr-encoders-consolidate-on-qrcode-generator)

- **The virtual PDF printer.** Print-payload retention is handled by daily housekeeping; virtual PDF output remains.
  [Detail](backlog/printers.md#the-virtual-pdf-printer)

- **Reprint kitchen tickets and other printouts laid out again for any printer (left open by A405
  point 4, #2678)** — needs a `print_jobs` column.
  [Detail](backlog/printers.md#reprint-kitchen-tickets-and-other-printouts-laid-out-again-for-any-printer)

- **Guest count** (bundle of 2, size S, needs the owner). [Detail](backlog/printers.md#bundle-guest-count)

- **Loose ends left by A661 (#1745).**
  [Detail](backlog/printers.md#loose-ends-left-by-a661-1745)

- **Receipt layout pass** (bundle of 3, 1 important, size M). Holds A960, A961, A1201. [Detail](backlog/printers.md#bundle-receipt-layout-pass)

- **One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still
  open:**
  [Detail](backlog/printers.md#one-receipts-settings-page-with-a-live-preview-c116-989-c120-1000-c121-996--still-open)

### Payments and card readers

_Formerly A6, and the old Track C's payments items; part of A9._ Detail: [backlog/payments.md](backlog/payments.md).

- **A742 — the guest types what they pay, and a tip (owner, 2026-10-15; on the backlog, NOT to be
  queued yet).** A flow where staff hand the device to the customer, who enters how much they want
  to pay of the bill and optionally adds a tip, then hands it back or pays on the reader. Builds on
  A739's payment window (An amount) and the bill payments design's tips. Not designed.



- **Stripe adapter upkeep** (bundle of 4, size S). [Detail](backlog/payments.md#bundle-stripe-adapter-upkeep)

- **A846's points for the owner at land: held card payments.** A kept payment has no invoice, the
  held alert comes back at midnight UTC, and smaller choices from the plan, the browser look and the review. Each stays open until the owner
  answers it. [Detail](backlog/payments.md#a846s-points-for-the-owner-at-land-held-card-payments)

- **The SumUp Solo experiments.** Still open after the 9 November cross-account session: signature-required
  cards, declined-card behavior, the statement/fee check, remaining connection
  probes and a second standalone machine sample. The reported decimal-`0.40` probe refunded the
  full payment, but its request bytes were not saved and the cause is unknown.
  [Sandbox checks and the owner’s 15-minute settlement script](research/2026-11-15-a949-sandbox-and-settlement-check.md)
  record the successful €10 Virtual A control, two virtual decline scenarios and a separate
  successful €10 Virtual B payment on 16 November. The €11 late result needed manager confirmation;
  €42.51 used generic decline wording. The owner's 17 November paired-Solo check captured EUR 1.40;
  its daily comparison awaits the post-midnight evidence and the owner. Backup-machine, PIN and
  signature qualification remain open. Idle SumUp battery refresh timing is unqualified; missing
  battery percentages need checking on the reader itself. No further paid request unattended.
  [Detail](backlog/payments.md#the-sumup-solo-experiments)

- **The deli's outage card machine.** Buy the standalone machine and
  replace estimated prices with real quotes.
  [Detail](backlog/payments.md#the-delis-outage-card-machine)

- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race); Stripe's reader list is one page.

- **The SumUp reconciler** — backup-machine hardware/signature qualification. The November
  results now include cross-account affiliate acceptance, pending/paid references, REFUNDED events
  and unpaid cancellation. The first recovery slice supplies Waitron's partner key and records
  identified refunds.
  Backup payment entry now records optional source, machine and operation details, including
  Other card machine on a counter with a configured reader. The day report and accountant workbook
  carry those details, current payment state and successful-refund totals. Physical second-Solo,
  other-provider and cash-only qualification remains open.
  [Detail](backlog/payments.md#the-sumup-reconciler)

- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.

- **Tap to pay restore** (bundle of 1, size M, needs the owner). [Detail](backlog/payments.md#bundle-tap-to-pay-restore)

- **Some card payments ask the cardholder to sign instead of enter a PIN — open question, nothing
  built.** Start by reading what the SumUp Solo actually does on a signature-required card,
  because if the reader owns the whole step there may be nothing for us to build.
  [Detail](backlog/payments.md#some-card-payments-ask-the-cardholder-to-sign-instead-of-enter-a-pin--open-question-nothing-built)

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
  code and an account with a password for the spare’s sign-in. The [ask-again plan](superpowers/plans/2026-11-09-a1437-1-dashboard-reproof.md)
  retains current authenticator codes for own-account changes; sessionless promotion and mirror
  creation keep body credentials. A Google-only account needs a password from password reset
  to open the window. Google proof and the later sign-in steps remain in the
  [design](superpowers/specs/2026-11-09-a1437-dashboard-sign-in-rules-design.md).

- **A venue without Cloud gets no dashboard email codes, texts or Google sign-in (left by A1437).**
  The owner, 2026-11-09: require a Cloud login for now; supporting a venue without one "shouldn't be
  forgotten". Low priority.

Detail: [backlog/dashboard.md](backlog/dashboard.md).

- **Form implementation leftovers:** eventual summary retirement. [Detail](backlog/dashboard.md#bundle-form-implementation-leftovers)




- **A1069. Venue settings keeps a `kitchen` tab key with no panel (owner question).** The key in
  `VENUE_SETTINGS_TABS` (`apps/dashboard/src/screens/venue-settings-screen.ts`) lets the page's tab
  checks keep a second tab; say if it should go (about 25 cases then lose their subject) — plan
  A756 PR 8 Decision 10.


- **Wt dialog lifecycle** (remaining: caret keys, covered-dialog reinsertion, wrappers, modifier picker and coverage leftovers). [Detail](backlog/dashboard.md#bundle-wt-dialog-lifecycle)

- **Should an all-archived product selection show Archive greyed out rather than hidden?**
  Left open by W110c (#1271); A435-1 removes Enable and keeps Archive hidden for that selection.

- **Override PIN limits (C89, #951), for the owner** — **Next action:** the owner decides whether to
  add the countdown and make the limit required. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **One session with real phones and password managers** (bundle of 13, 3 go-live, 7 important, size M, needs the real hardware; includes profile-name updates in password managers, field-focus verification and the remaining typography audit). [Detail](backlog/dashboard.md#bundle-one-session-with-real-phones-and-password-managers)

- **What C38 left as it was (a generated display name is the first given name and first surname,
  #827, owner decision 2026-09-28).**
  [Detail](backlog/dashboard.md#what-c38-left-as-it-was-a-generated-display-name-is-the-first-given-name-and-first-surname-827-owner-decision-2026-09-28)

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)** — remaining PIN-slot saturation, form focus and reset timing.
  [Detail](backlog/dashboard.md#every-login-failure-is-one-answer-c95-930-owner-decision-2026-09-30)

- **Move remaining dashboard tables onto shared database-backed requests.** Users, Orders and returned invoices now have
  50-row server pages with whole-dataset search/sort and passive refresh. Find a bill retains its
  existing request state until its own adoption.
  [Detail and decision](backlog/dashboard.md#shared-database-backed-table-paging-search-and-sorting)

- **Account security email decisions still open** (owner, 2026-09-12): notify the old address on an
  own-account email change; notices and wording for other administrator-made security changes
  (administrator email edits already notify the old address) and break-glass changes; grouping a burst.

- **Typed values are only partly checked — a generic phone-format check landed, a country-specific
  one has not.**
  [Detail](backlog/dashboard.md#typed-values-are-only-partly-checked--a-generic-phone-format-check-landed-a-country-specific-one-has-not)

- **Contrast-theme styles for the remaining primitives** (size M). The floor map and its overdue
  and forgotten rings remain.
  [Detail](backlog/dashboard.md#contrast-theme-styles-for-the-remaining-primitives)

- **Other browser check** (bundle of 4, size S). [Detail](backlog/dashboard.md#bundle-other-browser-check)

- **The new key and passkey icons draw lines at width 2** while the change-account icon beside them
  uses 1; the card copies the setup wizard's card styles rather than sharing `wt-card`, and nothing
  keeps the two in step. Left open by A191 (the dashboard's sign-in pages, #1074; owner to decide).

### Interface languages

_Formerly entries spread across the old sections, C125 among them; part of A9._ Detail: [backlog/languages.md](backlog/languages.md).

- **Native speaker review** (bundle of 3, size S, needs a third party). [Detail](backlog/languages.md#bundle-native-speaker-review)

- **Regional languages** (bundle of 3, size L, needs the owner). C125, the staff screens in every
  official language, is off hold (owner, 2026-11-08). Extend the setup working-language choices and
  starter translations beyond English and Spanish here. [Detail](backlog/languages.md#bundle-regional-languages)

### Alerts, logging and diagnostics

_Formerly A5, and the logging part of A9._ Detail: [backlog/alerts.md](backlog/alerts.md).

- **A982. Logging Slice 2 — one-touch bug report.** Dashboard, setup and till browser-only preview/download
  are implemented by the [download-first plan](superpowers/plans/2026-11-08-a982-client-only-report-first.md).
  Richer trail privacy and stored capture with manager read/download remain;
  stored capture needs its own plan. Cloud forwarding and automatic crash/freeze reporting are separate.
  [Detail](backlog/alerts.md#logging-diagnostics--one-touch-bug-report-a9-slice-1-landed-192).

- **A1047. Send a problem report to Waitron Cloud (owner, 2026-10-24).** The follow-up A982
  leaves open.
  [Detail](backlog/alerts.md#a1047-send-a-problem-report-to-waitron-cloud).

- **A1048. Opt-in automatic error reports to Waitron Cloud (owner, 2026-10-24: "Should be opt
  in").** Setup asks plainly, unticked; settings can change it.
  [Detail](backlog/alerts.md#a1048-opt-in-automatic-error-reports-to-waitron-cloud).

### Working time and staff

_Formerly A10; part of A9._ Detail: [backlog/workforce.md](backlog/workforce.md).


- **Staffing reads the day start in force on each date** (bundle of 2, size M, needs the owner). Holds A644, A708. [Detail](backlog/workforce.md#bundle-staffing-reads-the-day-start-in-force-on-each-date)

- **Staffing month day box** (bundle of 2, size M, waits for another entry). Holds A763. [Detail](backlog/workforce.md#bundle-staffing-month-day-box)

- **Wages / labour cost (SP16).** Gated on the labour advisor; not fiscal.
  [Detail](backlog/workforce.md#wages--labour-cost-sp16).

- **Inspector remote access to working-time records.**
  [Detail](backlog/workforce.md#inspector-access-to-working-time-records).

- **Have the labour advisor check working-time exports before go-live.**
  [Detail](backlog/workforce.md#advisor-review-of-the-working-time-export).

- **Payroll export waits for the gestoría's import format.**
  [Detail](backlog/workforce.md#payroll-export-and-unused-scheduling-tables).

- **Give the built close step a caller, then its cadence rule** (bundle of 2, 1 important, size M, needs the owner). [Detail](backlog/workforce.md#bundle-give-the-built-close-step-a-caller-then-its-cadence-rule)

- **Hours reads a person's full clock history for open and outstanding work.**
  [Detail](backlog/workforce.md#hours-open-and-outstanding-work).

- **A711. Special-day staffing dates come from the first area.** The read has no top-level date list. [Detail](backlog/workforce.md#a711-special-day-staffing-dates-come-from-the-first-area)

- **A712. The staffing painters have no "Opening hours | Staffing" switch in their bar, and a date
  that follows the season does not show the season's blocks faintly** — not built, by A585-4's plan.
  Each ‹ › step and each close adds a browser history entry, because a Calendar view can only push
  an address, not replace one.

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

- **A1323. One master key for the venue (owner, 2026-11-04; wanted, not designed).**
  The owner keeps one key, printed in the recovery pack, in place of the backup key and the server key; the box keeps only a check value and numbered backup keys calculated from it.
  Design it beside A1187 and A1188, which change the same restore steps. It changes the fiscal authority check, so the owner lands it.
  [Detail](backlog/box.md#a1323-one-master-key-for-the-venue)

- **A1187 part 3: the recovery pack's disk key page.** B3's development startup now creates and retains the key through `scripts/box/disk-key.mjs`; the protected host delivery and pack integration remain to be built. A pack
  that cannot carry the disk key is refused rather than drawn without it.
  [Design](superpowers/specs/2026-10-29-a1187-one-recovery-pack-design.md), [how part 1 leaves room](superpowers/plans/2026-10-29-a1187-recovery-pack-part-1.md#how-part-1-leaves-room-for-parts-2-and-3).

- **Recovery pack defaults and the Backups card's receipts** (bundle of 3, size S, needs the owner). [Detail](backlog/box.md#bundle-what-pack-part-1s-reviews-left)

- **Backups screen leftovers** (bundle of 1, size S, needs the owner). [Detail](backlog/box.md#bundle-backups-screen-leftovers)

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

- **Full disk: the till read that fails, and the words** (clock-in and attendance notices, and strip questions). [Detail](backlog/box.md#bundle-full-disk-the-till-read-that-fails-and-the-words)

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
  The owner authorised the build on 2026-11-01, one pull request at a time; [PR 1](superpowers/plans/2026-11-01-b3-1-encrypted-disk.md) (#2370) adds three host libraries under `scripts/box/`, none called yet. PR 2 (#2423, [plan](superpowers/plans/2026-11-03-b3-2-preboot-logic.md)) adds the preboot unlock gate with the proposed 2/4/8/16/32/60-second wait, the locked-mode redirect decision and the Wi-Fi record reader under `scripts/box/`, none called yet. PR 3 (#2426, [plan](superpowers/plans/2026-11-03-b3-3-installer-policy.md)) adds the installer's decisions and its network fallback decisions under `scripts/box/`, none called yet; the signed release list waits for A940's release slices and a chosen signature format. PR 4 (#2430, [plan](superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md)) defines the name tag (a LUKS2 token of Waitron's own type), its decoder, the finder and a write plan, and the Wi-Fi boot copy's writer and its write-or-why-not decision, under `scripts/box/`, none called yet. PR 5 (#2432, [plan](superpowers/plans/2026-11-03-b3-5-wifi-publication.md)) adds the Wi-Fi boot copy's publisher under `scripts/box/`, none called yet: it writes the copy through a flushed staging file, removes it on every "no copy" answer, refuses an unverified boot mount or an unsafe folder or file name with no write, and reports the copy's state. PR 6 (#2433, [plan](superpowers/plans/2026-11-03-b3-6-disk-key-letters.md)) adds the disk recovery key's conversion between 32 bytes and systemd's 64 letters, and reading a typed key back, under `scripts/box/`, none called yet. PR 7 (#2474, [plan](superpowers/plans/2026-11-05-b3-7-host-protocol.md)) adds the box host protocol under `scripts/box/`, whose request writer and reply reader PR 8's client calls (its answer function is called by nothing yet): seven of B3's requests as checked one-line requests with an ids-only actor, their checked replies, and an answer function that calls injected adapters and never puts a Wi-Fi password in a reply, a log entry or another adapter's argument; the clock requests stay on slice 9b's shell handler. PR 8 (#2495, [plan](superpowers/plans/2026-11-06-b3-8-host-client.md)) adds the server's client for those seven requests in `apps/server/src/box-host-client.ts`, called by nothing until PR 9: typed answers, never a throw, and a box with only the clock handler read as not taking them. PR 9 ([plan](superpowers/plans/2026-11-06-b3-9-host-routes.md)) builds it in `boot.ts` and answers six of those requests through routes behind `system.manage`, with the signed-in person as the actor; the development name-tag duty is now bound.
  The [host network read](superpowers/plans/2026-11-12-b3-19-network-status.md) connects the protected API to the installed NetworkManager. Installed host scan/join and restart-persistent boot-copy publication are implemented by [Wi-Fi host slice 1](superpowers/plans/2026-11-14-b3-wifi-host.md). [Wi-Fi host slice 2a](superpowers/plans/2026-11-14-b3-wifi-host-reconcile.md) adds forget and reconciles the boot copy at startup and after operations. [Wi-Fi host slice 2b](superpowers/plans/2026-11-15-b3-wifi-host-monitor.md) observes outside NetworkManager changes through the existing worker. [Box status controls](superpowers/plans/2026-11-15-b3-wifi-controls.md) scan, join and confirm Forget through that API. Real adapter/restart/power-cut qualification remains open.
  The [development recipe](../bench/box-installer/README.md) installs LUKS2 with five btrfs areas,
  retains its recovery key and seals to a virtual TPM. Its first disk boot requests a restart with Docker stopped;
  two subsequent chip-unlocked boots must remove the empty password and reach setup. The rig independently
  tests the retained key. Setup offers Prepare/Live/existing and refuses Demo.
  The development console shows Spanish and English together, names the checked venue and warns when its tag marks it Live; missing or unusable tags leave Live status unknown. It returns through the firmware's one-time boot choice after 15 seconds; keys pause it until 120 seconds without typing. `existing-stick` completes Prepare, waits for the server's startup counter to clear, then requires a continuous USB-to-disk return, unchanged target hash before installed startup, unchanged chip seal and `/health`. [Return cut](superpowers/plans/2026-11-11-b3-18b-firmware-return.md). The graphical warning, reinstall controls and physical qualification remain open.
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
  path retains a stopped copy, requires a successful disposable-copy sale and offers Restore/Keep.
  Later work is signed releases,
  automatic windows, status/email and pairs; after the first venue come the Cloud release check,
  password-checked go-back, proof-of-close and backup-stream handoff. Current-build synthetic Linux
  rehearsal does not qualify historical releases, a physical box or the whole shell `install` entry
  on an existing box (driver/bootstrap, non-recipe service/Docker drop-ins, host refresh and
  candidate download/build/pull). The [two-group plan](superpowers/plans/2026-11-09-a950-shorter-upgrades.md)
  records the owner's 9 November decision; the [area detail](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order)
  retains earlier designs, decisions and library limits.

- **Finish the clock work: a check at every start and every change** (bundle of 3, 1 go-live, 2 important, size L, waits for another entry). Holds A798. [Detail](backlog/box.md#bundle-finish-the-clock-work-a-check-at-every-start-and-every-change)

- **One steady-clock helper instead of hand-written clock-step-back guards** (owner, 2026-11-01,
  answering #2331). Move elapsed timers onto one shared helper, keeping each site's policy.
  The remaining-site inventory separates elapsed waits from persisted dates, ordering and calendar rules.
  [Detail and remaining-site inventory](backlog/box.md#one-steady-clock-helper-instead-of-hand-written-clock-step-back-guards).

- **Closing a pay period trusts the box's clock.**
  [Detail](backlog/box.md#closing-a-pay-period-trusts-the-boxs-clock)

- **A1268 part 2: pair a person's entries by write order after a backward clock step.** [Detail](backlog/box.md#a1268-part-2-pair-a-persons-entries-by-write-order-after-a-backward-clock-step)

- **Remaining bucket-copy limits** (outage starts, venue conditions and pause/error qualification; bundle of 2, size S). [Detail](backlog/box.md#bundle-remaining-bucket-copy-limits)

- **Qualify clock confirmation through remote access** (bundle of 1, size M). [Detail](backlog/box.md#bundle-qualify-clock-confirmation-through-remote-access)

- **A1407. A full invoice AEAT refused for a future date is put right by a replacement R4, built 2026-11-15 but switched off.** The writer and the case dialog's **Put this right** file an R4 "S" naming the same customer and the day the sale really happened, only while `FULL_INVOICE_REPLACEMENT_ON` in `packages/fiscal-verifactu/src/put-right.ts` is true; it is false, so the case dialog still says Waitron cannot put a full invoice right yet, and `computeVatReturn` counts such an invoice in its issue date's period until it is replaced. Turning it on waits for adviser question S14 and the R4 "S" probe on AEAT's test service (the probe entry under go-live). A simplified invoice refused for a future date is put right from the case dialog with a replacement R5 (Q37-FIX). Since A1420 PR 2, refusals for a future date (`1112`) no longer hold the rest of a chain; a record refused for a future date should get its corrective at once, naming the refused invoice, which AEAT's developer FAQ §17 says resolves it (case 2.a) and AEAT's test service accepted for an R1 (verifactu run 37286368370). Clocks running behind are not listed for the owner. The invoices to correct are those AEAT refuses as dated in the future (`1112`); a wrong date AEAT accepts is not corrected (owner, 2026-11-10; A1420 D8). An enabled remedy takes the start gate first (A1420 R7). AEAT's `TimestampPresentacion` is read but not stored: kept with each record, it would prove the real time of most sales, and that part needs a column, so it waits for the A1308 table hold to lift. Read, not run. [Findings](compliance/research/2026-11-06-adviser-clock.md)

- **Correct the sales dated wrongly once the tax adviser answers Q60.** What the correction is
  waits on [Q60](compliance/asesor-questions.md#q60-sales-dated-later-than-the-real-time-by-a-clock-that-ran-ahead-added-2026-10-24);
  A1420 PR 6 removed A1088's list, its notes and its download. Left open by A1088.

- **The accountant's file is comma-separated in both languages, and a spreadsheet set to expect
  semicolons may open the Spanish file in one column.**
  [Detail](backlog/box.md#the-accountants-file-is-comma-separated-in-both-languages)

- **Does a SumUp Solo that is on but idle report itself offline?** The owner's unused Solo read
  `OFFLINE` (slice 10 plan P11), and SumUp's client maps anything but `ONLINE` to offline, so if an
  idle Solo does the same, the bell carries a standing `reader.offline` warning. For the owner to
  check against the reader. Left open by A798-B slice 10.

- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on every log line — the connection-string shape and nothing else. [Detail](backlog/box.md#the-recovery-pages-secret-bound-is-a-convention-not-a-guard)

- **Resetting a box without a terminal** — owner, 2026-10-02. Wanted: a reset offered on the dashboard, and probably on the recovery page as well, because a box that will not start is the one an operator most wants to reset. Open: who may press it (the owner only?), and whether a reset started from inside the app container can remove the Docker volumes the script removes, or has to empty them instead. [Detail](backlog/box.md#resetting-a-box-without-a-terminal)

- **A venue preparing to go live sends real email through SMTP (A987) — BUILD.** Prepare now
  requires SMTP outside development for invoice and notice mail; selected account actions may use test Cloud. Settings lets admins
  save and remove the relay, with manager reads and actionable SMTP tests. Users and Account settings
  distinguish queued, captured and unconfigured account mail, and an immediate invitation
  retry says when nothing changed. Ordinary SMTP and Settings tests use the venue sender name.
  Demo's normal route captures account mail, reminders and alerts outside development; an enabled
  test Cloud relay takes its three selected account classes.
  Left: qualify account email against the live test Cloud (BOX-EMAIL-RELAY, invitations, resets
  and email changes); receipts and other notices retain SMTP. The published Cloud grant interface
  is available, but real inbox delivery still needs the joint test.
  [Detail](backlog/box.md#a-venue-preparing-to-go-live-sends-real-email-through-smtp-owner-2026-10-03--open)

- **The setup wizard's email test connects wherever an unauthenticated caller points it (A987
  review, 2026-10-22) — OPEN.**
  [Detail](backlog/box.md#the-setup-wizards-email-test-connects-wherever-an-unauthenticated-caller-points-it-a987-review-2026-10-22--open)

### Replication, failover and the cloud

- **A1438. Code Waitron and Cloud share, published like ui-core (owner, 2026-11-08).** The
  box builds pairing and machine requests through the database-free workspace package `@waitron/contract`,
  which also supplies the access-lease format. The box still reads leases through its own saved-state adapter.
  The UI publisher now checks and uploads both packages, including `@waitron-io/contract`.
  Cloud installs private signing release `0.2.9` with its workflow token. Remaining: the sign-in
  rules (with A1437 and Cloud's D608), then the message list and texts (with Cloud's D610 and the
  email relay). Roles, storage, sessions and
  screens stay apart. [Plan](superpowers/plans/2026-11-09-a1438-code-shared-with-cloud.md).

- **Everything needing a third box or a Cloud peer** (bundle of 8, 1 important, size L, waits for another entry). Holds A1205, A1275, A1276. [Detail](backlog/replication-cloud.md#bundle-everything-needing-a-third-box-or-a-cloud-peer)

_Formerly _Afterwards_ and _Cloud connection integration_._ Detail: [backlog/replication-cloud.md](backlog/replication-cloud.md).

Not in any track until the standalone primary is done.

- **Address search provider, province names, guide lines** (bundle of 2, size M, waits for another entry). Holds A1171, A1171. [Detail](backlog/replication-cloud.md#bundle-address-search-provider-province-names-guide-lines)

- **A1018: physical-box qualification remains the owner's.** The local two-box test covers a
  controlled handover and a reset/rejoin emergency takeover with Veri*Factu. Cloud emergency start
  stays with A1188; Cloud-to-box handover stays with A1505.
  A1505 has a [dependency record](superpowers/plans/2026-11-17-a1505-cloud-to-box.md); its build plan waits for P6/D634 and the joint hosted formats.
  [Local receipts and remaining qualification](backlog/replication-cloud.md#a1018-agree-and-build-the-hosted-writer-stop-proof-contract)

- **A947 owns the spare's authenticated switch screen** (watcher, 2026-11-08); the spare's
  dashboard is retired. [Decision](backlog/replication-cloud.md#decisions-and-deliberate-limits).

- **A captured signed peer query can be replayed later to read a box's status, or a stepped-down box's indicator and final copy.** The peer-status
  route checks the query's `atMs` but never uses it, so there is no freshness window; a strict one
  would lock out a box with a wrong clock. Owner's choice. Left open by A1018 Slice 3 (Ruling R6).

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
  already on the new main; a late payment on an older box's chain is not included in this return.
  An A802 correction's row and refund links do not travel (`invoice_corrections` and
  `invoice_correction_refunds` are not in the return), so cash an unfinished correction gave back
  arrives as ordinary refunds, and no correction on the new main can cover it.
  [Detail](backlog/replication-cloud.md#a1342-return-a-stopped-boxs-records-before-reset)

- **A third box's chart can leave another box serving-secondary and filing.** The remaining
  third-box cases from A1342 need their own approved scope; the owner accepted the two-box bucket
  stop as clearing A947 3b-6 on 2026-11-09. [Detail](backlog/replication-cloud.md#a-box-the-chart-no-longer-names-main-keeps-filing-its-earlier-records)

- **Series and module-preparation gaps at handover** (bundle of 2, at least 1 go-live, size M, waits for another entry). [Detail](backlog/replication-cloud.md#bundle-series-and-module-preparation-gaps-at-handover)

- **Decide what the old promote route still does** (bundle of 2, at least 1 important, size S). Holds A1279. [Detail](backlog/replication-cloud.md#bundle-decide-what-the-old-promote-route-still-does)

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

- **A1425. Every restore takes its own identity (owner, 2026-11-07).** A restored box still
  keeps the old box's identity. Part 3, cut to Cloud's emergency copy (Cloud agreed on 15 November),
  gives a copy Cloud placed a machine identity of its own, in three pull requests
  ([plan](superpowers/plans/2026-11-17-a1425-3-fresh-identity-restore.md)), all three built: the
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
  [Part 1 plan](superpowers/plans/2026-11-14-a1188-part1-emergency-card.md).
  [Part 2 plan](superpowers/plans/2026-11-15-a1188-part2-till-facts.md) covers saved facts and the till entrance; Claude reviewed it and the watcher cleared slice 2a on 15 November.
  Cloud agreed the [part 3 proposal](superpowers/plans/2026-11-15-a1188-part3-locked-start.md) on 15 November and its purpose-key input on 17 November (Cloud #1276). Part 3a provides a separate locked HTTPS process with read-only sign-in and memory-only sessions; its [developer API](developers/cloud-connection.md#locked-emergency-copy-api) reuses A1425 placement. Part 3b adds the separate English/Spanish sign-in and actor/expiry page. Cloud launcher, declaration/activation (part 4) and production qualification remain open. The watcher cleared this API cut on 17 November; no owner approval of the key amendment is claimed.
  Lane G agreed the [part 4 confirmation request and replies](superpowers/plans/2026-11-17-a1188-part4-declaration-contract.md). The [Waitron plan](superpowers/plans/2026-11-18-a1188-part4-waitron.md) leaves live use of the locked page's status read waiting for Cloud D115/P6 and year-sized qualification. Live activation waits for Cloud to prove that the old box's remote access and backup writes are refused before it replies confirmed.
  Qualify with a current-baseline year copy before go-live.
  [Detail](backlog/replication-cloud.md#a1188-someone-at-the-venue-can-start-the-venue-in-the-cloud-when-the-box-has-died-owner-2026-10-29)

- **Remaining setup and failover gaps** (bundle of 6, 3 important, size M). [Detail](backlog/replication-cloud.md#bundle-remaining-setup-and-failover-gaps)

**The on-prem mirror.** Joining and local takeover are built and exercised on separate databases;
this section records the remaining build and real-box qualification.

- **A947. Go-live on two local boxes.** The owner approved the revised design. Slice 3b's build
  plan is written (eleven pull requests, all landed); 3b-1, 3b-2 ([#2742](https://github.com/clintongormley/waitron/pull/2742)),
  3b-3 ([#2761](https://github.com/clintongormley/waitron/pull/2761)), 3b-4 ([#2779](https://github.com/clintongormley/waitron/pull/2779))
  3b-5a ([#2898](https://github.com/clintongormley/waitron/pull/2898); the pair link, and a spare joins with no Cloud relay)
  and 3b-5b (a spare runs its store, which admits only its main box) landed, and so did 3b-G (a box trusts only the venue's authority when it asks another box at start and sets aside a spare still joining ([3b plan](superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md) D19, lane A's decision, which the owner may overrule); its chart check at start reaches a real box under the venue's authority, which still refuses it for want of a credential; and a box that lost its own record does not start selling or filing), and so did 3b-6a (the first copy and finishing joining), 3b-6b (a two-box test of joining, and the guide's Add a spare box) and 3b-6c-email (a spare's join and its reset take the administrator's sign-in email), and so did 3b-6c (the main box sends its backup settings to its spare, again after every change and to a spare that was off), and 3b-F completes them. A joined spare now follows into a separate scratch copy. Box status, Servers and the bell show measured spare progress and warnings. Since 4b an emergency switch first brings the spare's copy up to date from the followed copy. Since 4c a till or handheld shows a red strip after 20 s without the main box, whose button opens the spare's switch page. Since 4d-2 Servers prints a switch label for the main box and for the spare: a QR code for that box's switch page. Since 4d-3a the dashboard accepts a passkey at each box's own name that the box's held chart lists, as well as at the venue's name, where that box serves the dashboard (a spare still shows its closed page there); server tests only, not yet measured on till hardware. Since 4d-3b a manager can sign in to the emergency switch's steps with a passkey; measured in tests only, not on till hardware. 3b-4 retired `WAITRON_MIRROR_ALLOW_EXPOSED` (a spare now listens on the
  venue's network), one step **Hand over the venue** needs on real boxes. It is not live yet: a spare
  of a venue that does not file with Veri*Factu now receives a copy over the venue's network, puts
  it in place at its next start and finishes joining as a standby. With
  3b-F a Veri*Factu venue's spare joins too, with nothing fiscal written at the join; the activation
  writes the spare's dormant setup first, and a two-box test on separate databases runs a handover
  to the joined spare and the old box's return by emergency switch after a reset (A947 3b-F, 2026-11-14). A second box in setup mode can be trusted by mistake in three ways, to settle before go-live. [Detail](backlog/replication-cloud.md#a947-go-live-on-two-local-boxes)

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

The membership, promotion and rejoin arc remains in the tree. What remains, largest first:

- **Status, alarms and the operator surface for replication.** An operator needs to see whether the
  standby is keeping up, and to be alarmed when it is not.

- **Fiscal-certificate distribution** — rebuild on the asynchronous adopt. Open design question:
  how the dormant certificate is protected when the seal must happen after the initial copy.
  [Detail](backlog/replication-cloud.md#fiscal-certificate-distribution)

- **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document and pick one
  rule: every role change is a restart, or the worker-lifecycle manager — not both.

- **The mirror as a backup destination**, and the mirror's print agent (gated on B6's cross-box
  TLS).

- **Adding a mirror while the internet is down** (owner, 2026-10-02). Since 3b-6a a spare takes its
  first copy over the venue's network, and since 3b-F so does a Veri*Factu venue's; left: the
  owner's measurement with the internet unplugged (3b plan Task 6.11).
  [Detail](backlog/replication-cloud.md#adding-a-mirror-while-the-internet-is-down)

**Cloud integration and SQLite work.**

- **Loose ends left by the Cloud connection integration.** Customer remote setup UI and production
  deployment remain open. Continuous complete-server recovery, planned final-write handover and
  production recovery remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-cloud-connection-integration)


- **A951-S provider trials.** Public staff-name changes and automatic certificates still need joint
  qualification. Translate all returned one editable menu suggestion on the test box;
  address completion still needs its trial. Keep the approved consent and request limits.
  [Detail](backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)

- **Waitron retains:** first-contact trust bootstrap; and the cloud-standby end-to-end proof. Do not restart the cloud-standby work until the boundary contract is settled.
  [Detail](backlog/replication-cloud.md#waitron-retains)

- **Loose ends left by the SQLite failover-loop prototype gate.** Provider qualification,
  promotion generations and the Cloud recovery contract remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-sqlite-failover-loop-prototype-gate)

### CI, tests and developer tooling



- **CI incidents to watch.** The table groups retained CI sightings with their evidence and what to retain on recurrence. [Detail](backlog/ci.md#ci-incidents-to-watch)

- **Finish qualifying CI's server routing and action setup** (bundle of 2, size M). Checked real-run records cover tools/history/API, PR planner pickup, scheduled rescue and idle pickup, one no-op overflow, natural blind fallback and fresh-capacity route choices before later idle alarms, including an idle-server choice followed by successful server jobs and natural agreeing-row stale-count acceptance followed by a successful hosted run. The browser workload passed on disposable runners, and an earlier run supplied venue-service failure diagnostics. A1424/A1440 still need a full server coverage run, an image guest, per-job and remaining-workflow evidence, and the full-day queue measurement. The historical planner cause remains unproved. Planner recovery from short workflow lists still needs natural-run evidence; standalone `check` tolerates short queued lists with an explicit partial observation, while running/job lists and other health commands retain their rules. A935 waits for a natural setup-download stall before its [experiment proposal](superpowers/plans/2026-11-16-a935-action-download-experiment-proposal.md) is revisited; build no new guest capability now, and the job limit remains unqualified. The bundle remains open. [Detail](backlog/ci.md#bundle-qualify-cis-server-routing-and-action-setup)

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


- **apps/server's test speed: restart tests and recovery-key checks** (bundle of 2, size L). The restart tests and wider recovery-key memo adoption remain. [Detail](backlog/ci.md#bundle-appsservers-test-speed-restart-tests-and-recovery-key-checks)

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

- **One small pull request for rule lines** (bundle of 2, size S). [Detail](backlog/ci.md#bundle-one-small-pull-request-for-rule-lines)

For database fixtures filtered by business day, make the boundary explicit and exercise the
changeover. See the [testing guide](developers/testing-guide.md#a-recent-timestamp-can-belong-to-the-previous-business-day).

- **Vitest settings: remaining measurements** (bundle of 2, size M). Worker pins need a loaded runner, and the setup optimizer control was inconclusive. [Detail](backlog/ci.md#bundle-vitest-settings-remaining-measurements)

- **A1398. Test-file inventory only on a same-count mismatch** (1 conditional entry). [Detail](backlog/ci.md#bundle-a1398-pack-the-other-packages-test-shards-by-measured-time)

- **A668-5. Remaining captured root-test failures.** [Detail](backlog/ci.md#a668-5-normal-push-recurrence-2026-10-16).

- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites; the
  duplicated `boot.*.test.ts` helpers into `apps/server/src/testing/` (`freePort` has moved there,
  A80; the rest remain); a shared `useFiscalMirrorPair()` for the two-clone fiscal suites.

- **What the stream pause test's last-restore fix (A387, #1398) left open:** a local Linux run
  keeps the machine's own loopback and can still meet the stall (how often was not measured), and a
  box's restore over a real network was not measured.

- **Unused peers, versitygw binds, fiscal callers and saved-origin restarts still need port ownership (A80/#740, A907, A1152).**
  [Remaining caller audit](backlog/ci.md#what-the-landing-port-fix-a80-pr-740-left-open).
- **Give the failover bench an endpoint that stays refused for its lifetime**, preserving its bounded actual-ECONNREFUSED probe and SDK/Litestream consumers.
  [Detail](backlog/ci.md#give-the-failover-bench-an-endpoint-that-stays-refused).


- **A throwaway script found six comments that described code that was no longer there, and it is not a guard yet**
  [Detail](backlog/ci.md#a-throwaway-script-found-six-comments-that-described-code-that-was-no-longer-there-and-it-is-not-a-guard-yet).

- **`packages/db`'s static mutants are not in its mutation score** (needs the owner). [Detail](backlog/ci.md#packagesdbs-static-mutants-are-not-in-its-mutation-score).

- **drizzle-kit 0.31.11 left out `ON DELETE` when it generated an `ALTER TABLE … ADD … REFERENCES` on this engine, while its snapshot kept it.**
  [Detail](backlog/ci.md#drizzle-kit-03111-left-out-on-delete-when-it-generated-an-alter-table--add--references-on-this-engine-while-its-snapshot-kept-it).

### Dependency upgrades

_Formerly parts of B9 and Track C._ Open work:
[backlog/dependencies.md](backlog/dependencies.md).

- **A Vitest 5 retry still needs mutation qualification after the Stryker 10.1.1 update.**
  [Detail](backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it)

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  [Detail](backlog/dependencies.md#collapse-the-two-typescript-entries-back-into-one-once-typescript-eslint-supports-version-7)

- **What package manifests declare: floors and the root engines line** (bundle of 2, size S). [Detail](backlog/dependencies.md#bundle-what-package-manifests-declare-floors-and-the-root-engines-line)

- **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo.**
  [Detail](backlog/dependencies.md#the-default-browser-floor-rose-and-no-browser-floor-is-stated-anywhere-in-the-repo)

- **The till's QR pin compares the code against itself, not an authority.**
  [Detail](backlog/dependencies.md#the-tills-qr-pin-compares-the-code-against-itself-not-an-authority)

### Modules, data and code health

_Formerly B8, parts of B9, and the old Track C's correctness items; part of A9._ Detail: [backlog/architecture.md](backlog/architecture.md).

- **Query plans and indexes, measured on a year of data** (bundle of 3, 2 important, size M, waits for another entry). [Detail](backlog/architecture.md#bundle-query-plans-and-indexes-measured-on-a-year-of-data)

- **A1308. Rationalise the tables, background jobs, environment variables and files** (owner,
  2026-11-02: "over engineered and disjunct … each bit has been designed in isolation"). The
  [design](superpowers/specs/2026-11-02-rationalisation/README.md) is written, and the owner has
  reviewed every file and answered every question (2026-11-04). **Approved by the owner, 2026-11-04, and the top priority: it runs before more code is built on the old tables.**
  Lane A runs it, once A1018's current slice ends. Until A760's squash lands, slices in progress finish and no lane starts new work that adds or changes tables; work that touches no tables carries on. Slice 0's protection list is built ([how to use it](developers/testing-guide.md#the-protection-list)); so is its bench ([how to use it](developers/testing-guide.md#the-bench)). [A760's squash into eight sets](superpowers/plans/2026-11-04-a760-squash-into-eight-sets.md) has landed; the shared-table work is under way. 246 tables become 145, or 144 once A1323 removes
  `recovery_packs`; 111 environment variables become 51. The SMTP sender now lives in the mail
  settings document; the connection URL stays sealed.
  Privacy details now live in venue settings, and legal-name and credential changes keep activity history.
  Ended dashboard sessions are deleted; sign-in history comes from activity records. Email-change
  proofs use the pending address without copying it into the proof row.
  [Detail](backlog/architecture.md#a1308-rationalise-the-tables-background-jobs-environment-variables-and-files)
  What it retires, listed until each slice lands: [What A1308 retires](backlog/architecture.md#what-a1308-retires).

- **Small checks and indexes that are cheap only inside A1308's fresh tables** (bundle of 9, 6 important, size M, waits for the A1308 table hold to lift). Holds A1368. [Detail](backlog/architecture.md#bundle-small-checks-and-indexes-that-are-cheap-only-inside-a1308s-fresh-tables)

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

- **The venue's menu routes are named unlike their neighbours.** S5 moved them to
  `/management-api/venue/…`, as the A1301 plan chose, while the other venue routes are one
  hyphenated segment (`/management-api/venue-details`, `/venue-defaults`). Pick one shape before
  go-live.

- **Remove code nothing reaches (replaced or dead, never merely unused)** (bundle of 1, size S). [Detail](backlog/architecture.md#bundle-remove-code-nothing-reaches-replaced-or-dead-never-merely-unused)

- **Loose ends left by the tenant-column removal (#378, 2026-09-16).** Index names that still
  read `tenant`, and `server.credential_unusable`'s prefix (fiscal: one index is on
  `registros_facturacion`; its own slice, not a tidy-up, because three `persons_*` names are
  matched by name in error translation).
  [Detail](backlog/architecture.md#loose-ends-left-by-the-tenant-column-removal-378-2026-09-16)

- **Go-live day steps.**
  [Detail](backlog/architecture.md#go-live-day-steps).


- **Full-invoice recipient: country code names** (bundle of 1, size S). [Detail](backlog/architecture.md#bundle-full-invoice-recipient-country-code-names)

- **Spanish text in a server test venue, for A913's English-only audit.**
  `apps/server/src/testing/bill-venue.ts` names its products "Paella" and "Caña", and in the look
  test's venue the Spanish refund dialog shows the reason "Mistake" in English. Found by A798-B
  slice 8 (#2012).

- **Regional demo screen qualification.** Inspect the seeded till, kitchen and dashboard in both
  screen languages, themes and phone/desktop widths when the stack is available. The regional cuts'
  local Mailpit start refused the absent Docker socket. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A974. Finish the remaining English names in general code.**
  A private person binding (`marta`, shown as Martha) remains in the protected
  `clock-set.route.test.ts`; check the clock-suite boundary before renaming.
  Protected fiscal and receipt helpers still need their boundary audit.
  Other split-suite comments and file names remain.
  Remaining server drink bindings include the sale-source receipt, issuance-identity, list-price
  identity and served-at-huella fixtures. Keep accented search fixtures unchanged.
  Other record and submission names remain in server seed, snapshot and fiscal-identity suites;
  check protected fixtures and fiscal-provider contracts before renaming them.
  Low priority.
  [Detail](backlog/architecture.md#a974-finish-the-remaining-english-names-in-general-code).

- **Qualify the split-table new-bill no-sale check.** Find a control that reaches the existing
  no-sale assertions with an unwanted sale or record. Existing probes have not established that
  they can fail; no product defect has been demonstrated.
  [Detail](backlog/architecture.md#a974-review-assertion-gaps).

- **A976. Finish the server's English test-venue defaults.**
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
  The provision, setup-api.throwaway, promote-api.handover, break-glass-command and
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
  The own personal-data download (`me-api`) and box-health samples use Martha and Rose; stream-route and cross-person profile administrators use Administrator.
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
  served-at-huella, split-bill fiscal and tabs filing suites.
  Remaining local venue seeds, including email and the other sale suites, and the boot helper's raw
  location names should use `Main room`, as `setupVenue` does. The till-sale suite uses Main room,
  Administrator, Food and Drinks for its local staff samples; its product and fiscal text remain. Current-order, order-group,
  order-draft, served, certificate, backup-settings and backup-room fixture names use it. The shared
  `setupVenue` uses Administrator, Drinks, Coffee and Water.
  Local published-menu, menu-patch, current-order, integrated-sale, delivery, pay-and-dispatch
  and stuck-payment fixtures use Administrator, Main room and Drinks where present.
  Other display samples in those files remain.
  BillVenue uses Steak,
  Red wine bottle, House salad, Croquettes and Octopus as staff keys; its Spanish customer
  and kitchen names stay. PartyVenue uses Red wine bottle and Water as staff keys,
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
  Triage made-here route and receipt-document fixture
  text there while preserving Spanish receipt output and locale checks. Low priority.
  [Detail](backlog/architecture.md#a976-finish-the-servers-english-test-venue-defaults).
  BillVenue's receipt printer, card readers and cash till use English display names.
  Local device-equipment and office-printer route fixtures use English printer and reader names;
  their shared BillVenue device names and venue/operation samples remain.

- **Correct every sentence known to be false, then finish comment pruning** (bundle of 14, size M). [Detail](backlog/architecture.md#bundle-correct-every-sentence-known-to-be-false-then-finish-comment-pruning) The pruning sweep still has `bench/`, `scripts/release/github-release.sh`, `scripts/fake-bluez.py` and `scripts/write-path-tables.json` open.

- **Printer, reader and device delete wording and tidying** (bundle of 2, size M, needs the owner). [Detail](backlog/architecture.md#bundle-printer-reader-and-device-delete-wording-and-tidying)

- **Unchecked: pairing a new reader can undo the SumUp registration it just made** when SumUp is
  disconnected during the add (the post-provider compensation branch of the add-reader route,
  `apps/server/src/payments-api.ts`), and an adoption running at the same time is not told.
  Believed to predate A435 step 3 (#1520); not reproduced.


- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).


- **Loose ends left by A394-3 (#1447).**
  [Detail](backlog/architecture.md#loose-ends-left-by-a394-3-1447).

- **A394-5, A394-16 and A394-20 to A394-22 — refusal statuses by one rule** —
  OPEN, low priority, not queued — owner 2026-10-08: take them from here when a lane has room. (A394-1 to A394-4 landed as #1441, #1444, #1447 and #1455.) The follow-ups and the rows:
  `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.
  [Detail](backlog/architecture.md#a394-5-a394-16-and-a394-20-to-a394-22--refusal-statuses-by-one-rule)

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

- **A module this server runs with no transfer declaration, or no recorded version, is refused as
  `setup.request_invalid` field `module:<name>`** (`packages/provisioning/src/configuration-transfer.ts`),
  which setup words, when the export is uploaded, as "The configuration export could not be opened.
  Check the file and passphrase." That blames the file for a fault in this server's own build. An
  export from a box running other modules now has its own code, `setup.configuration_parts_differ`
  (A1384). Left open by A261-2e's review (#1277); whether a shipped build can reach it is unverified.

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
  ten answers; its small slices are planned. S9 and S11 wait for the specialists.
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
  Follow §7; the [receipt and pointer limits](developers/writing-claims.md#root-instruction-receipts-retained-on-2026-10-14)
  stay with the detail. There is no size gate.
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

- **Main pushes keep quick checks; package tests run on PRs and full runs (owner, 2026-11-08, A1452).** [Exceptions and merge-risk decision](backlog/ci.md#decisions-and-deliberate-limits).

- **Keep the pre-push hook quick, with typechecking retained (owner, 2026-11-08, A1449).** [Decision and limits](backlog/ci.md#decisions-and-deliberate-limits).

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
| 8   | Reporting                    | daily close, frozen _cierre Z_, VAT summary, modelo 303 output+input VAT + DR303 file and its download route and its dashboard screen, purchase-invoice UI; dashboard sales screen (with a category sales report, at time of sale or current, printable) + business-overview home                                                                                                                                                 | fiscal filing remainder parked (_Reporting — the fiscal remainder_)                                                                                                           |
| 9   | Deployment                   | the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); boot diagnosability (#310); CA-trust onboarding + per-OS certificate walkthrough (#330); till reroute S1–S6; promotion endpoint (#272)                                                                                                                                                                                     | USB installer (B3: physical qualification remains); cloud standby live link + the Waitron Cloud boundary                                                                                                      |
| 10  | Tabs / table service         | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324)                                                                                                                                                                                                                                                                                                             | core COMPLETE; owner-added extensions parked                                                                                                                                  |
| 11  | Floor plan                   | FP-1 live floor + FP-2 spatial canvas/editor                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                             |
| 12  | KDS / devices                | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269)                                                                                                                                                                                                                                                                        | routing audit view; a device-scoped collect route                                                                                                       |
| 13  | Tips                         | tip choices on bill payments (card, cash) and on the whole-order screen for a connected reader, off unless `WAITRON_TILL_TIPS` is set; kept off the invoice; sharing and payroll: A793's first design not approved, needs a brainstorm                                                                                                                                                                                                                       | sharing, the Tips page and the pay-period statement (A793); payroll export (integrate-not-build)                                                                              |
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

**No fiscal advisor is engaged yet.** One quoted on 2026-10-09: €300 an hour and about an hour for
each of the 106 bullets in the 6 October list. The same day every bullet was researched against
primary sources and the list was cut to seventeen questions, S1–S17 (S17, on selling by weight,
is legal metrology rather than tax), and a review list, R1–R6:
[the shortened list](compliance/asesor-questions.md#the-shortened-list-2026-10-09). The owner records that list as sent around 15 October. The [next batch](compliance/2026-11-05-consultas-para-asesores.md) is prepared for the owner to review and send, with separate fiscal, labour, privacy and consumer-law parts. Answers remain open. Before paying for answers, agree the scope and price.
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
| Q27–Q29 (paying a bill in parts, a table that leaves without paying, how a comp or discount shows)    | parts: server built (#721), the till does not use it yet; comps and discounts built (#916); leaving without paying built on the owner's decision (B17)                                                     | S3, S6, S10 (A445, A447) |
| Q31 (correct an issued ticket by differences or by substitution)                                      | `recordCorrection` files by differences (`"I"`); the whole-order cancel credit and A802's part corrections call it                                                                                                              | **Answered**: the business's choice (art. 15.5; AEAT FAQ) |
| Q32 (how a cancelled order's already-issued simplified invoice is undone)                             | the whole-order cancel credits the invoice in full with an R5 corrective invoice, not an annulment (C126)                                                                                                  | S7 |
| Q42 (a bill paid later by transfer: invoice now, or a proforma and the invoice on payment; F1 and F2) | the till's server closes such a bill as a deferred payment, invoice issued at the meal (`POST /api/working-orders/:id/close-deferred`, A275); the open bill's, the presented bill's and the Counter's Pay windows send it (A275 Task 7). The Pay route refuses every tender but cash and card (`sale.unsupported_tender`) | Option 2 not lawful for a consumer; deposits S8, unpaid debts S6 |

**The laboral advisor** (a _graduado social / gestoría_) has its own list in
[asesor-laboral-questions.md](compliance/asesor-laboral-questions.md). Nothing there blocks the build;
two items want confirming before go-live (the digital-registro RD's status; the provincial convenio
and figures), plus whether the venue's exported working-time record may show per-node chains. The
gestoría's payroll import layout is the one build dependency (it fixes the D3 export format). How card tips are booked remains Q49; the employer-paid tip payroll questions remain L6. Both are included in the next batch.

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
| [Expo device kind](superpowers/specs/2026-08-17-expo-device-kind-design.md)                                                                                                                       | superseded by A366 slice 5 Part A (a device's pass screen and pass monitor)                                                                                                  | —                                                                         |
| [Star CloudPRNT](superpowers/specs/2026-08-17-printing-cloud-poll-transport-design.md) and [Epson Server Direct Print](superpowers/specs/2026-08-17-printing-epson-server-direct-print-design.md) | not started beyond the `cloud_poll` columns; low priority                                                                                                                  | _Printers, the print agent and receipts_                                  |
| [Failover printing](superpowers/specs/2026-08-26-failover-printing-design.md)                                                                                                                     | partly built (the job lease, network printers any agent may claim, unprinted kitchen tickets shown on the till, #750)                                                      | _Printers, the print agent and receipts_, _Replication, failover and the cloud_ |
| [Every device enrolled, fail closed](superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md)                                                                                    | partly built; deferred                                                                                                                                                     | The till, devices and table service                                       |
| [Language fallback](superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md)                                                                                                     | regional content versions built; live regional names are exact enabled overrides; generic and recorded-snapshot fallback retain their existing rules | nothing in the backlog                                               |
| [Native app capabilities](superpowers/specs/2026-08-30-native-app-capabilities.md)                                                                                                                | reference; nothing committed                                                                                                                                               | the go-native decision                                                    |
| [Logging and diagnostics](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md)                                                                                                  | Slice 1 built (#192)                                                                                                                                                       | _Alerts, logging and diagnostics_                                         |
| [Fiscal certificate distribution](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) and its plan                                                                                   | reverted (#281); describes a removed mechanism                                                                                                                             | _Replication, failover and the cloud_                                     |
| [Handheld app store and kiosk](superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md)                                                                                             | reference; its own-phones decision reversed 2026-09-18                                                                                                                     | —                                                                         |
| [Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)                                                                                          | discussion record; not started                                                                                                                                             | _The box: backups, upgrades and recovery_                                 |
| [Failover prototype](superpowers/specs/2026-09-16-sqlite-failover-prototype-design.md) and its plan                                                                                               | done (#425); `bench/sqlite-failover` points at it                                                                                                                          | _Replication, failover and the cloud_                                     |
| [SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md)                                                                                               | slices 1–2 and A947 local joining/takeover built; real-box qualification and Cloud work remain                                                                                                                                   | _Replication, failover and the cloud_                                     |
| [Handheld and till hardware decisions](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)                                                                                      | decisions; the reader dropdown exists                                                                                                                                      | _Payments and card readers_ (Slice 2)                                     |
| [Menus, sections and home layouts](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md) and its plan                                                                         | built (#729 last); owner decisions still open; its home layouts superseded by W93's [Device Home Page design](superpowers/specs/2026-10-05-w93-device-home-page-design.md) | _Menus and the menu_ (_Sales classification and the menus plan — what they left open_) |
| [Service, ordering and billing](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) and its plan                                                                                 | all 18 tasks landed (Task 17 last, #991); what they left open is under The till, devices and table service                                                                 | The till, devices and table service                                       |
| [Sales classification](superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md) and its plan                                                                             | built (#738 last); a code comment points at it                                                                                                                             | _Menus and the menu_ (_Sales classification and the menus plan — what they left open_) |
| [Bill payments](superpowers/specs/2026-09-26-bill-payments-design.md)                                                                                                                             | server built (#721); the till side built by lane B item B15 (#956)                                                                                                         | The till, devices and table service                                       |
| [Print agent setup lockdown](superpowers/specs/2026-09-27-print-agent-setup-lockdown-design.md) and its plan                                                                                      | all three branches built (#732, P2b in #877, and P2c in #884); a real pairing at the box to go                                                                             | _Printers, the print agent and receipts_                                  |

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
