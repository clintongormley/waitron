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
- [Restore paths run](backlog/setup.md#bundle-restore-paths-run)
- Design with the owner: whether to do A798 slice 9c, since a clock that drifts ahead while the box runs dates sales in a way that cannot be repaired (a start's clock is confirmed first since A1420 PR 1a); and the
  A1323 master key, because A1187 parts 2 and 3 change the same restore steps.

**2. Go-live fixes that can start today.** They add no tables and no lane holds them. Till bundles
run one after another, because they share `apps/till/src/till-app.ts`.

- [A950. Automatic upgrades with rollback](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order): go-live (owner, 2026-11-09); copy/restore and attempt transitions are dormant libraries. Host installation, readiness with a copy-sale, trial and activation remain in the [approved first group](superpowers/plans/2026-11-09-a950-shorter-upgrades.md).

**3. The foundation, already running.** A1308 stays first in lane A, with
[Small checks and indexes that are cheap only inside A1308's fresh tables](backlog/architecture.md#bundle-small-checks-and-indexes-that-are-cheap-only-inside-a1308s-fresh-tables). A1306's history rewrite is A1308's last step (owner, 2026-11-06).

**4. Released by the hold, once A760 lands.** Build order: the pay window, A446 pre-bill,
A555, close the day, then A947 and its handover bundles, including the spare's backup settings, which
A947 3b's plan still owes. A1150 (allergens from the live product) is needed before go-live and has
no design yet.

- [The pay window, after A739](backlog/till.md#bundle-the-pay-window-after-a739)
- [Close the day: count the cash, record cash in and out, waiter floats](backlog/till.md#bundle-close-the-day-count-the-cash-record-cash-in-and-out-waiter-floats)
- [Series and module-preparation gaps at handover](backlog/replication-cloud.md#bundle-series-and-module-preparation-gaps-at-handover)
- [Finish the clock work: a check at every start and every change](backlog/box.md#bundle-finish-the-clock-work-a-check-at-every-start-and-every-change)
- [Check everything at the offer, while the old box still sells](backlog/replication-cloud.md#bundle-check-everything-at-the-offer-while-the-old-box-still-sells)
- [Query plans and indexes, measured on a year of data](backlog/architecture.md#bundle-query-plans-and-indexes-measured-on-a-year-of-data)
- [The spare's wait loop: back-off, reasons, stop signals](backlog/replication-cloud.md#bundle-the-spares-wait-loop-back-off-reasons-stop-signals)
- [Re-read old failover lists after 3b, delete what it retired](backlog/replication-cloud.md#bundle-re-read-old-failover-lists-after-3b-delete-what-it-retired)
- [Joined-table writers keep their rows right](backlog/till.md#bundle-joined-table-writers-keep-their-rows-right)
- [Everything needing a third box or a Cloud peer](backlog/replication-cloud.md#bundle-everything-needing-a-third-box-or-a-cloud-peer)
- [After A760: A877's one helper first](backlog/service-periods.md#bundle-after-a760-a877s-one-helper-first)
- [One rule for what holds a table back at a reset](backlog/till.md#bundle-one-rule-for-what-holds-a-table-back-at-a-reset)
- [The key ring after a join](backlog/setup.md#bundle-the-key-ring-after-a-join)
- [Qualify clock confirmation through remote access](backlog/box.md#bundle-qualify-clock-confirmation-through-remote-access)
- [Which state files a handover carries; summary checks](backlog/replication-cloud.md#bundle-which-state-files-a-handover-carries-summary-checks)
- [Recheck that a spare gets later charts](backlog/replication-cloud.md#bundle-recheck-that-a-spare-gets-later-charts)
- [Get ready for A1308's history rewrite (A1306 and CI's concurrency groups)](backlog/ci.md#bundle-get-ready-for-a1308s-history-rewrite-a1306-and-cis-concurrency-groups)

**5. Important work.** The bundles marked important under each area, taken by theme so that a lane
stays in one area.

**6. After the first venue.** The remaining bundles, which are nice to have. Take
them only when a lane has nothing better.

**Features the owner ranked on 2026-10-16 that are still open:** A803 bills and tables, A646 the
Modules page, A664 archiving or deleting old data, and A802 correcting part of a paid invoice, whose
[build plan](superpowers/plans/2026-10-22-a802-partial-paid-invoice-correction.md) has had its
protected-writer approval since 2026-10-22.

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
  follow the owner's 29 October evidence-first decision. The 08:07 instruction approves the
  read-only build after fresh plan review and coordination of shared files. The screen and its
  qualification remain open. A local queue-reset marker does not prove a repeat submission;
  persistent recovery remains open.

- **A1089: fiscal environment refusals need safe configuration or recovery guidance.** Separate a wrong host environment from missing immutable metadata. Never relabel records, promote test data or reset invoice numbering.
  [Audit](backlog/self-service-refusals.md#fiscal-environment).
  The owner approved running-dashboard evidence-first planning on 2026-10-29. The
  [implementation plan](superpowers/plans/2026-10-29-a1089-fiscal-environment-evidence.md)
  awaits separate build approval. Persistent repair from the running dashboard remains open;
  the startup database guard also applies. A1501 supplies the wrong-environment failed-start
  Move/Stop route; it never relabels the retained database.

- **A1089: a fiscal reply-line mismatch needs accurate retry and evidence choices.** Describe only the drain behavior actually exercised, then offer evidence inspection and a decision path for persistent malformed replies, with any required sign-in there.
  [Audit](backlog/self-service-refusals.md#fiscal-reply).
  The [inspection design](superpowers/specs/2026-10-28-a1089-fiscal-reply-recovery-design.md) and
  [implementation plan](superpowers/plans/2026-10-29-a1089-fiscal-reply-evidence.md) follow the owner's
  29 October evidence-first decision. The read-only build is approved once the plan has had its fresh
  review; implementation and qualification remain open. The first retained warning may differ from
  the latest reply; persistent repair requires a separate owner decision.

- **A1089: fiscal filing-case alerts need a real decision route.** Use W41s-8/W41s-9 when released, or keep the missing workflow explicit. Rejections, cancellations, duplicate conflicts and repeated refusals cannot be fixed by an invented retry screen.
  [Audit](backlog/self-service-refusals.md#fiscal-cases).

- **A1089: fiscal integrity and validation alerts need evidence-preserving next steps.** Replace support-only guidance without editing records or treating every warning as a proven Waitron bug. A substantial missing recovery workflow requires an owner decision.
  [Audit](backlog/self-service-refusals.md#fiscal-integrity).
  The owner chose evidence-first inspection on 2026-10-29; the 08:07 instruction approves
  building the [integrity evidence plan](superpowers/plans/2026-10-29-a1089-fiscal-integrity-evidence.md)
  after its fresh review, subject to coordination of shared files. The
  [proposal](superpowers/specs/2026-10-29-a1089-fiscal-integrity-recovery-design.md) retains the source audit.
  The screen remains to be built. Saved predecessor-check issues and local validation warnings
  are distinct; persistent repair and whole-chain auditing remain open. Inspection does not establish AEAT acceptance.

_Formerly A1 (with A1a–A1e, A231, A231d, A275 and W41s), and the old Track C's fiscal items; part of A9._ Detail: [backlog/fiscal.md](backlog/fiscal.md).

- **A940. Waitron's declaración responsable — design approved 2026-10-22; slice 1 landed 2026-10-23 (#2000).**
  Task 8 landed: the producer's name, tax number and postal address are three public settings each official image carries from repository secrets, never committed; a production start refuses without them, and refuses when its chain was made under another producer. The three secrets hold placeholder values for now (owner, 2026-11-08); replacing them (`gh secret set --env-file ~/waitron-campaign-shared/private/producer-identity.env --app actions --repo clintongormley/waitron`) is safe only while no box has started in production, because a production chain refuses a different producer tax number until A993 lands, and every full run's publish job fails while any is missing; once an image carrying a placeholder is published, the publish job also refuses the real tax number unless the repository variable `WAITRON_PRODUCER_CHANGE_ALLOWED` holds it; apart from replacing the placeholder, do not change the tax number until A993 lands; watch the first nightly or manual publish (its load-then-push build had not run on GitHub before). The real-fork test (the plan's 8g Step 5) is still to do. Slice 2 landed (#2820, #2827 and #2836): the text, its renderer, the A4 PDF's renderer (no command writes a PDF yet), the package's `declaration` command, and `pnpm release prepare` and `pnpm release tag` with their [runbook](operations/release.md). Both release commands refuse until the template's two release-blocker lines are deleted: the Q53 one when the asesor's answer is recorded, the slice-4 one by slice 4. Slice 3's first three pull requests landed (#2861, #2874, #2916): every box, in every state and on every listener, answers `/legal/declaration` (and `.pdf`, `.txt`) and `/legal/about`, and says it has no declaration until slice 4 puts the files in the image; the dashboard's account menu and sign-in screen open About Waitron; on the till, More holds About Waitron just above Log out, and a kiosk's or kitchen screen's corner and the PIN and pairing screens have an ⓘ that opens it; pull request 4 adds it to the setup wizard and adds the guide's About Waitron page ([plan](superpowers/plans/2026-11-11-a940-3-in-app-declaration.md)). The rest of slice 3, and slices 4 to 6, remain; slice 4 also makes CI refuse a `v*` tag whose declaration is missing or carries a blocker, because a tag pushed by hand skips both commands. 1b (A993) waits until a producer change is scheduled.
  Still needed from outside: the asesor's answer to Q53. The owner's publishable address is settled (supplied 2026-11-04; it travels with the other two).
  [Detail](backlog/fiscal.md#a940-waitrons-declaración-responsable--design-approved-2026-10-22-slice-1-landed-2026-10-23-2000).

- **A993. A change of the system's identity opens a new installation by itself — designed in A940 §5.6, approved 2026-10-22; fiscal, the owner lands it.**
  Built only once a producer change is actually scheduled (owner, 2026-11-11, "Later"); the plan
  is kept unlanded on branch `docs/a993-identity-change-plan`. Until then a production box given
  another producer tax number refuses to start (`sif.producer_changed`). Constraint on its plan (owner, 2026-11-06): a start opens a new installation for a producer difference only when the upgrade's own marker names that same new producer; otherwise it keeps refusing.
  [Detail](backlog/fiscal.md#a993-a-change-of-the-systems-identity-opens-a-new-installation-by-itself--designed-in-a940-56-approved-2026-10-22-fiscal-the-owner-lands-it).

- **One owner session with a real certificate against AEAT** (bundle of 3, 3 important, size S, needs a third party). Holds A1270, A888, A679. [Detail](backlog/fiscal.md#bundle-one-owner-session-with-a-real-certificate-against-aeat)

- **A444. A full invoice for a meal past midnight should carry the day the meal ends.** Automatic bill-close dating excludes Bill requested and staff date choice. Exact H2 scope approved; build waits for A739 integration. Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a444-a-full-invoice-for-a-meal-past-midnight-should-carry-the-day-the-meal-ends).
- **Structured B2B invoices before the applicable 2027 or 2028 date.** Establish the issuer's threshold and recipient scope, then build structured exchange and required reporting. Current paper/email qualification stays separate.
  [Detail](backlog/fiscal.md#structured-b2b-invoices-before-the-applicable-2027-or-2028-date).

- **Can a simplified invoice carry an operation date different from its issue date?** — left open by A663 Part 2.
  If it can, art. 7.1.c requires that date on the receipt. Check, then record the date on such a sale if needed.
  [Detail](backlog/fiscal.md#can-a-simplified-invoice-carry-an-operation-date-different-from-its-issue-date).

- **A445. A free item on a bill with mixed VAT rates should take a share of the price paid.** Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a445-a-free-item-on-a-bill-with-mixed-vat-rates-should-take-a-share-of-the-price-paid).

- **A446. Build the pre-bill: each printed pre-bill is stored as printed and linked to the invoice that follows — OPEN, build it now to the strict reading, without waiting for S2 (owner, 2026-11-04).** Needs a build plan from A803 §3.9.
  [Detail](backlog/fiscal.md#a446-when-the-pre-bill-is-built-each-printed-pre-bill-is-stored-as-printed-and-linked-to-the-invoice-that-follows).

- **A447. A guest's part-payment taken before the table is fully served may need its own advance-payment invoice.** No change until answered.
  [Detail](backlog/fiscal.md#a447-a-guests-part-payment-taken-before-the-table-is-fully-served-may-need-its-own-advance-payment-invoice).

- **A448. Whether a customer's email address alone satisfies TRLGDCU art. 63.3 for an emailed full invoice.**
  [Detail](backlog/fiscal.md#decisions-and-deliberate-limits) _2026-10-12: the product no longer asks for consent at all — A231q's tasks C1a and C1b
  removed it ([plan](superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md)) on the owner's 2026-10-09 answer. Until 2026-10-12 this entry asked
  that the consent request say how the invoice will arrive and how consent is withdrawn._

- **Loose ends left by A230 (`@waitron/verifactu` 0.2.1, #1099).**
  An unusable `TiempoEsperaEnvio` is not recorded anywhere (the raw value is dropped).
  [Detail](backlog/fiscal.md#loose-ends-left-by-a230-waitronverifactu-021-1099)

- **The till offers no way back to a simplified invoice for a bill already saved as a full one.**
  [Detail](backlog/fiscal.md#the-till-offers-no-way-back-to-a-simplified-invoice-for-a-bill-already-saved-as-a-full-one).

- **Owner decision 2026-09-24: a void counts on the day it is made, not the day of the sale** —
  The quarterly _modelo 303_ keeps its old behaviour until the asesor answers Q25 (which VAT period a later annulment lands in).
  No till screen or server route calls `recordVoid` yet.
  [Detail](backlog/fiscal.md#owner-decision-2026-09-24-a-void-counts-on-the-day-it-is-made-not-the-day-of-the-sale)

- **One authorised edit of a protected test, plus its neighbours** (bundle of 2, size S, needs the owner). [Detail](backlog/fiscal.md#bundle-one-authorised-edit-of-a-protected-test-plus-its-neighbours)

- **Adviser confirmation: supplier invoice numbers by issue year.**
  [Detail](backlog/fiscal.md#adviser-confirmation-supplier-invoice-numbers-by-issue-year).

- **Reporting — the fiscal remainder (parked)** — left open by the modelo 303 work (#76, #91, #98, #1106).
  [Detail](backlog/fiscal.md#reporting--the-fiscal-remainder-parked)

- **A231/A948. Full invoices at the till** — table bill payments and unpaid departures can issue F1; counter sales and collection remain refused until A555 carries the delivery choice.
  **Next action:** complete A555, A444, physical paper/QR qualification, the asesor's manual-remedy confirmation and current business-invoice delivery qualification as separate work. The owner removed these as switch prerequisites on 2026-10-27.
  An unpaid departure that issues the invoice of a presented bill loses the table name on it: `issueUnpaidInvoice` saves it only on an open bill (`apps/server/src/working-order.ts`), and neither `settleIssuedOwingNothing` nor the later collection sets it. A close by transfer now passes it to `settleIssuedOrder` (A275); a bill that leaves owing needs a decision on when to save it.
  [Issuance and remaining limits](backlog/fiscal.md#a231-full-invoices-at-the-till)

- **Show a late success, decide the address, fix those strings** (bundle of 3, 1 important, size S). Holds A554, A557, A558. [Detail](backlog/fiscal.md#bundle-show-a-late-success-decide-the-address-fix-those-strings)

- **A555. Keep a counter full invoice's email or A4 choice through payment** — DESIGN APPROVED,
  plan and build against A739's released interfaces.
  No implementation or public F1 enablement is included.
  [Detail](backlog/fiscal.md#a555-counter-full-invoice-delivery-through-payment--design-proposed-2026-10-21)

- **A556. A full invoice that later replaces a bill's simplified one would not be delivered through
  the bill.** Nothing issues an F3 today: no route calls `recordSubstitution`.
  [Detail](backlog/fiscal.md#a556-a-full-invoice-that-later-replaces-a-bills-simplified-one-would-not-be-delivered-through-the-bill)

- **A275. Invoice a bill paid later by transfer (full or simplified invoice)** — DESIGN APPROVED; [reviewed plan](superpowers/plans/2026-10-22-a275-final-transfer-close.md) published. Tasks 0–4 and 6 built: the `transfer_closures` table, the close command, its till route and recovery read, and a device-profile action that is off by default ([2026-11-09 plans](superpowers/plans/2026-11-09-a275-transfer-close-command.md), [Task 3 plan](superpowers/plans/2026-11-10-a275-transfer-close-route.md)); receipts, Orders, Find bill's Transactions and the Counter screen name a closed bill Deferred payment, «Pago aplazado» (owner, 2026-11-11; [Task 4 plan](superpowers/plans/2026-11-11-a275-transfer-labels.md)); and the accountant's file (Task 6, [plan](superpowers/plans/2026-11-11-a275-transfer-export.md): its server route, and a button on **Sales & takings** for a session holding `report.export`). Task 5 built: the overview and Sales report show Bills closed and Deferred payment apart from money received ([Task 5 plan](superpowers/plans/2026-11-11-a275-closed-bills.md)). No till screen sends a close until Task 7 puts it in the till's Pay flow, after A739 Cut B.
  Invoice at the meal, close finally by transfer, preserve sibling/service checks, and export for the accountant; no later receipts or debt.
  The precise H2 writer approval, released clock/Pay contracts and separate F1/delivery/physical gates remain.
  [Design](superpowers/specs/2026-10-22-a275-final-transfer-close-design.md), [detail](backlog/fiscal.md#a275-invoice-a-bill-paid-later-by-transfer-full-or-simplified-invoice--design-now-2026-10-17).

- **W41s. Fiscal prevention and offline recovery.** Filing investigation (W41s-9) and the complete
  old-backup/new-hardware exercise (W41s-11) remain queued. Signed witnesses and fencing (W41s-10b)
  were retired on 9 November 2026: A1342 (#2654) and A1418 with A1425 cover them. Qualify live AEAT reconciliation, production TLS, a till payment through a booted
  restored server, and history before the oldest known month. Task 8's disputed production remedies
  remain disabled pending Q35/Q37/Q38/Q40 or a case-specific owner decision. Once its original's
  correction is accepted, on any issuing chain, an administrator may release a held cancellation
  through a remedy, which only a test policy enables today (`ENABLED_REMEDIES` is empty,
  `packages/fiscal-verifactu/src/record-remedy-routes.ts:20`).
  [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04).

- **Allocated standby adoption still needs the primary's venue copy and fresh establishment
  authority.** Complete the copy and authenticated establishment path before presenting a successful fiscal
  join. The pending file alone supplies no live authority.
  [detail](backlog/fiscal.md#w41s-4-adoption-boundary-checkpoint-2026-10-14).

- **Settle the hold and the brake once** (bundle of 2, 2 important, size S, needs the adviser). [Detail](backlog/fiscal.md#bundle-settle-the-hold-and-the-brake-once)

- **For Task 9 (the filing screen):** `listFilingCases` reads every case and event with no filter or
  paging, and `heldRecords` reads every `rechazado`/`detenido` row; neither has a production caller
  yet, so the screen should add an open-only filter or paging when it calls them. From W41s.

- **The reconcile sweep may raise a second "accepted with errors" warning.**
  [Detail](backlog/fiscal.md#the-reconcile-sweep-may-raise-a-second-accepted-with-errors-warning).

- **Loose ends left by C126 (cancelling an order whose invoice was issued credits it, #1030).**
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **The next adviser batch awaits the owner's decisions, then sending.** The [curated English list](compliance/2026-11-06-adviser-questions.md) replaces the Spanish draft, which covered the additions after the shortened list and the labour questions. Adviser answers, including Q19, remain open. The owner records the earlier shortened list as sent around 15 October; do not send its questions again as a new batch.
  [Detail](backlog/fiscal.md#asesor-questions-to-send)

- **Task 6 (#818) and C50 (#847): the ticket of a bill collected after a correction still shows the original invoice total.** **PARKED (owner,
  2026-09-29)** until the product can issue a corrective invoice; the owner's points for that design are on the corrective-invoice entry (R5, above). Left
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

- **A802 — correct part of a paid invoice: build the approved design.**
  **2026-11-09:** The first arithmetic foundation and cumulative base/VAT bounds follow the [approved cash-first extraction plan](superpowers/plans/2026-11-09-a802-cash-first-extraction.md); staff correction preview/acceptance remains a later slice.
  **2026-11-09:** Slice 2 ([plan](superpowers/plans/2026-11-09-a802-exact-vat-writer.md)): `recordCorrection` files a supplied `partialVatBreakdown` only when it follows slice 1's rule given every earlier correction, and refuses any other supplied split; without the field nothing changes.
  **2026-11-10:** Slice 3 ([plan](superpowers/plans/2026-11-10-a802-correction-history.md)): `previewCorrectionAmounts` reads an invoice's correction history, asks the regime whether its filing admits a correction, and refuses an invoice whose filed figures differ from the stored ones; staff get nothing yet. An AEAT preproduction run of the final-cent shape comes before the slice staff can use.
  **2026-11-11:** The owner chose option A (a fix of a refused invoice never changes its amounts, [A1481](backlog/fiscal.md#a1481-a-fix-never-changes-an-invoices-amounts-owner-2026-11-11)), so slice 3b, filing at the figures the agency accepted after a fix, is dropped and #2775 closed; slices 4–5 are re-planned against the figures stored at sale time ([plan](superpowers/plans/2026-11-11-a802-slices-4-5.md)).

  Follow the [build plan](superpowers/plans/2026-10-22-a802-partial-paid-invoice-correction.md), including its separate protected-writer approval
  and exact-gross qualification. The fiscal PR waits for the owner to land it.
  After A760, rebase onto the squashed base and regenerate its migrations there; its tables go in core's set (`packages/db`). Before landing, show its new tables in `apps/server`'s `pnpm protection-list`: a table in a retired migration folder creates nothing.
  [Detail](backlog/fiscal.md#nothing-in-the-product-can-issue-a-corrective-invoice-r5-_factura-rectificativa_-for-a-vat-error-on-an-issued-simplified-invoice)

- **Correct VAT without returning money.** Design the separate correction for a wrong VAT rate
  or classification when the customer's gross total stays the same. The owner left this out of
  A802's money-back scope on 2026-10-21; no build is approved.
  [Detail](backlog/fiscal.md#correct-vat-without-returning-money)

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live filing.**
  The advisor is asked only to confirm (review item [R3](compliance/asesor-questions.md#the-shortened-list-2026-10-09)).
  **Non-blocking while pre-production; blocking before going live.**
  [Detail](backlog/fiscal.md#no-tax-0-is-an-open-fiscal-question-and-it-must-be-answered-before-the-first-live-filing)

- **Rename the `hour-*` names to minute names** — left by A947 slice 4a.
  Before go-live it needs no compatibility code: until then any installation may be reset (CLAUDE.md §3).
  [Detail](backlog/fiscal.md#rename-the-hour--names-to-minute-names).

- **Should `packages/fiscal-verifactu` have a mutation floor?**
  [Detail](backlog/fiscal.md#should-packagesfiscal-verifactu-have-a-mutation-floor).

- **A1411. A page and an export for the tax office (go-live; owner, 2026-11-06).** A venue must let the tax office see, search, copy and print every invoice when it asks. Waitron cannot: the dashboard has no invoice list, the till's lookup finds only full invoices with a named customer, up to 20, and nothing exports a period's invoices. Build one read-only page and one period export on the box, searchable by every field of the invoices-issued book (RIVA article 63.3), with a sign-in that shows tax information only (RD 1007/2023 article 8.4). Cloud shows the same page through its servers, so venues without Cloud get the same capability. It is needed whatever the adviser says on T4; a no would add remote access on top. It overlaps A664's reader. [Research](compliance/research/2026-11-06-adviser-online-access.md).

### The setup wizard, onboarding and the demo venue

- **Recovery operations still buffer whole database files.** First-setup repair snapshots retain
  their 128 MiB budget; Start again's deletion fingerprints and Cloud snapshot creation also read
  whole database files. Replace these buffers with file-based processing while preserving their
  exact-content checks. Ordinary first-setup admission no longer uses these snapshots.
  [Detail](backlog/setup.md#recovery-operations-still-buffer-whole-database-files).

- **A1186. The setup tour offers Waitron Cloud's level-2 trial (owner, 2026-10-29).**
  **Build remains open**; Cloud's qualified trial journey is prerequisite G1 in the plan.
  Stays in the backlog, in no lane, until Cloud's sign-up and trial pages and a real box-to-Cloud connection exist (owner, 2026-11-09).
  [Detail](backlog/setup.md#a1186-the-setup-tour-offers-waitron-clouds-level-2-trial-owner-2026-10-29).

- **A1215. Correcting invoices issued under a wrong clock** (from A1207): a box can hold invoices
  dated after the real time (a restored backup from a box whose clock was fast). Nothing in Waitron
  corrects them, and what to do about them with AEAT is undesigned. Design first.

- **A1385. The A1207 leftovers in choosing a series name** (bundle of 1, 1 important, size S). Holds A1223: start a new attempt by itself (owner, 2026-11-07: series are cheap and a retry may take a second series name). [Detail](backlog/setup.md#bundle-a1385-the-a1207-leftovers-in-choosing-a-series-name)

- **A1089: setup and backup recovery must distinguish waiting from missing capability.** Separate absent callbacks/services and incompatible or refused retained artifacts from temporary work; offer a supported source, image or recovery choice and any required sign-in there.
  [Audit](backlog/self-service-refusals.md#setup-readiness).

- **A1089: an incomplete-join reset needs an outcome after a failed restart.** Retain authenticated reset proof and add a supported way to retry or restart if the half-join remains.
  [Audit](backlog/self-service-refusals.md#setup-reset).

- **A1089: a different-environment partial setup needs an applicable fresh-start route.** Distinguish this from the authenticated half-adopt reset. Establish the safe fresh-server/reinstall action before offering it.
  [Audit](backlog/self-service-refusals.md#setup-environment).

- **A1089: setup state refusals need a usable resume or recovery route.** Read A1042's S7l change first. Handle retained-operation mismatch and damaged setup without directing the owner to support; keep operation ownership and fiscal evidence. A1158, A1159 and A1161 list what still refuses.
  [Audit](backlog/self-service-refusals.md#setup-state).

- **A1158: a damaged setup record or claim marker still dead-ends Start again.** Left open by A1099.
  [Audit](backlog/self-service-refusals.md#a1158-a-damaged-setup-record-or-claim-marker-still-dead-ends-start-again).

- **A1159: some setup databases the box cannot read still refuse Start again.** A damaged one is
  deleted since A1131bc slice 2; one it may not open, one beside a journal, and a damaged `node.db`
  still refuse. Left open by A1099.
  [Audit](backlog/self-service-refusals.md#a1159-some-setup-databases-the-box-cannot-read-still-refuse-start-again).

- **A1161: with the database present, a public record or documents file still dead-ends Start
  again**, damaged or intact, and since A1206 so does the summary. Left
  open by A1099; needs an owner decision.
  [Audit](backlog/self-service-refusals.md#a1161-with-the-database-present-a-public-record-or-documents-file-still-dead-ends-start-again).

_Formerly A2 and B1._ Detail: [backlog/setup.md](backlog/setup.md).

- **Loose ends left by A496 (moving to a new tax ID).**
  [Detail](backlog/setup.md#loose-ends-left-by-a496-moving-to-a-new-tax-id)

- **A boot test's disk assertion reads the checkout's path**, so it fails in a worktree whose path
  holds "disk". [Detail](backlog/setup.md#a-boot-tests-disk-assertion-reads-the-checkouts-path)

- **The key ring after a join** (bundle of 2, 1 important, size S, waits for another entry). Holds A1285, A1284. [Detail](backlog/setup.md#bundle-the-key-ring-after-a-join)

- **Restore paths run** (bundle of 3, 3 important, size S). [Detail](backlog/setup.md#bundle-restore-paths-run)

- **`restoreFromArtifact` has no production caller.** Only tests call it since A1131bc slice 4;
  decide whether they should place archives through `runStagedRestore`, then delete it.
  [Detail](backlog/setup.md#restorefromartifact-has-no-production-caller)

- **"The saved setup cannot be read. Contact support."** sends the person to somebody else. Left
  open by A1131bc slice 3.
  [Detail](backlog/setup.md#the-saved-setup-cannot-be-read-contact-support)

- **Setup wizard tidy** (bundle of 5, size S). [Detail](backlog/setup.md#bundle-setup-wizard-tidy)

- **OWNER DECISION, open since #443: should the setup wizard still OFFER "Add a mirror node"?** But
  the option is still there and the flow still runs, so an operator can still spend a box on it.
  Removing or disabling it until slice 3 lands the replacement is a product call, not a wording one.
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

- **The configuration preview names what it will copy by database table** — left open by C42
  (#837). Give them operator words, grouped, or keep the table names.
  [Detail](backlog/setup.md#the-configuration-preview-names-what-it-will-copy-by-database-table)

- **File input sweep** (bundle of 2, size M). [Detail](backlog/setup.md#bundle-file-input-sweep)

- **A237. Nothing guards the hint-or-"?" rule across screens (owner 2026-10-03)** — OPEN.

- **Starter courses for Italy.** When its country pack is built, add the four courses and settle
  their firing defaults. [Detail](backlog/setup.md#starter-courses-for-italy)

- **A guided tutorial for Demo and Preparation (A250, owner 2026-10-03)** — OPEN, partly designed,
  not to be built yet (owner: "we just mustn't forget it"); needs a spec before queueing.
  [Detail](backlog/setup.md#a-guided-tutorial-for-demo-and-preparation-a250-owner-2026-10-03)

- **`pnpm dev:reset` deletes the venue folder before it refuses `WAITRON_ENV=production`.**
  `apps/server/scripts/dev-setup.ts`'s `main()` calls `resetVenueDir` under `--reset` before
  `devSetup` reaches `demoSeedEnvironment`, against the file's header. Fix: the same check at the
  top of `main()` that `dev-onboard.ts` has. Found by A680.

- **A fresh Demo venue opens its dashboard on a red tax-filing alert** (`fiscal.submission_delayed`
  over the demo seed's back-dated sales). Found by A680.
  [Detail](backlog/setup.md#a-fresh-demo-venue-opens-its-dashboard-on-a-red-tax-filing-alert)

- **A Demo venue shows Bills closed 0 · €0.00 beside its takings**: the demo seed's sales
  (`apps/server/scripts/demo-seed/seed-sales.ts`) have no bill behind them. Fix: seed each sale
  under a settled bill, as the till does. Found by A275 Task 5.

### Menus and the catalogue

- **A1515. Set lunch menus, the _menú del día_ (owner, 2026-11-11): go-live.** One fixed price for a
  menu of courses, where the guest picks a dish for each course (say one of three starters), with
  bread, a drink or coffee included and an extra charge for a premium choice. The receipt shows one
  line. Today a set lunch can only be sold as separate dishes with their own prices. Needs a design,
  including how VAT is worked out on the one price (a question for the adviser).
  [Detail](backlog/catalogue.md#a1515-set-lunch-menus-the-menú-del-día)

- **A1517. Accepted allergen changes before go-live (owner, 2026-11-11): go-live.** The owner accepted
  the recommendations; still to build: design A670's guest menu and show recorded declarations in
  Orders history detail. The till's sent dishes now retain their first-send declarations; held
  dishes remain live until released. The [sent-order/history plan](superpowers/plans/2026-11-12-a1517-6-sent-allergen-history.md)
  leaves the Orders history slice open.
  The [cleared new-selection plan](superpowers/plans/2026-11-12-a1517-2-allergen-choices.md) leaves option-list labels unfiltered because they carry no allergen data.
  [Proposal](superpowers/specs/2026-11-11-a1517-allergen-proposal.md) · [Detail](backlog/catalogue.md#a1517-allergen-points-to-revisit-before-go-live)

- **Menu prices' narrow-layout CI failure still needs a cause (A613).**
  [Detail](backlog/ci.md#menu-prices-narrow-layout-ci-failure-still-needs-a-cause-a613)

- **Tabs selected visible** (bundle of 2, size S). [Detail](backlog/catalogue.md#bundle-tabs-selected-visible)

- **A884. Deleting an options or extras list leaves it on the published menus until they are
  republished.**
  [Detail](backlog/catalogue.md#a884-deleting-an-options-or-extras-list-leaves-it-on-the-published-menus-until-they-are-republished)

- **A885. Say that lines already on an open order keep their VAT class after a republish.**
  [Detail](backlog/catalogue.md#a885-say-that-lines-already-on-an-open-order-keep-their-vat-class-after-a-republish)

- **A670 — guest-menu mock-ups first; printing/build stopped (owner, 2026-11-12).** A printed menu carries each
  dish's allergen icons after its name and a key on the page naming every icon.
  The owner brought its basic guest-menu design forward on 11 November through A1517.
  [Detail](backlog/catalogue.md#a670--printed-menus-owner-2026-10-14-open-not-designed)

- **Icon button** (bundle of 2, size M). [Detail](backlog/catalogue.md#bundle-icon-button)

- **wt-data-table: heading wrap, long names, odds and ends** (bundle of 11, size M). Holds A1318, A543, A890. [Detail](backlog/catalogue.md#bundle-wt-data-table-heading-wrap-long-names-odds-and-ends)

- **One language fallback rule** (bundle of 5, 1 important, size M). [Detail](backlog/catalogue.md#bundle-one-language-fallback-rule)

- **Translation report excludes image names (C122, #1006).** The media module's
  `contentTranslations` seat supplies only a kind and an id. Showing a name or editor link needs
  a separate seat design that respects module boundaries; no change is queued.

- **The media library still reads every matching image for search and name sorting, inside the venue
  write lock** — OPEN (found 2026-09-23, task F1's review wave).
  [Detail](backlog/catalogue.md#the-media-library-still-reads-every-matching-image-for-search-and-name-sorting-inside-the-venue-write-lock)

- **Two price rules disagree about a value that is not negative** — OPEN (found 2026-09-21, task
  N4).
  [Detail](backlog/catalogue.md#two-price-rules-disagree-about-a-value-that-is-not-negative)

- **A547 — Preview tab: "Publish later" sits to the left of "Publish now", and "Scheduled versions"
  shows only when something is scheduled** (owner, 2026-10-12). Wanted: the two buttons on one
  line, Publish later first; the heading and table drawn only while at least one version is queued.
  [Detail](backlog/catalogue.md#a547--preview-tab-publish-later-sits-to-the-left-of-publish-now-and-scheduled-versions-shows-only-when-something-is-scheduled)

- **Menu home tab** (bundle of 4, size M). [Detail](backlog/catalogue.md#bundle-menu-home-tab)

- **Tree drag shared** (bundle of 2, size M). [Detail](backlog/catalogue.md#bundle-tree-drag-shared)

- **After A760 moves the bundle format: An import checks rows as a save does** (bundle of 4, size S). Holds A1074. [Detail](backlog/catalogue.md#bundle-after-a760-moves-the-bundle-format-an-import-checks-rows-as-a-save-does)

- **A person who may not read routing sees the "Kitchen routing unavailable" line above the
  Products list, which tells them to try again later**, because a refused read counts as a failed
  one, and trying again changes nothing for them. Left open by W86 (#1203) and A655.

- **Translate all followups** (bundle of 9, size M). [Detail](backlog/catalogue.md#bundle-translate-all-followups)

- **Translate all: shared collect-page test vectors.** Nothing compares the fake Cloud's paging
  (`apps/server/test/translation-cloud-fixture.ts`) with Cloud's own; vectors Cloud generates and
  both sides check would catch drift in CI. A contract change for Cloud's side.
  [Detail](backlog/catalogue.md#translate-all-shared-collect-page-test-vectors)

- **Product folders, menus that include menus, and prep station routing: partly built (design
  approved 2026-09-30).**
  [Detail](backlog/catalogue.md#product-folders-menus-that-include-menus-and-prep-station-routing-partly-built-design-approved-2026-09-30)

- **Sales classification and the menus plan — what they left open.** `Product.categoryId` and
  `primaryCategoryId` always hold the same value.
  Include demo and readiness sales when finishing classification.
  [Detail](backlog/catalogue.md#sales-classification-and-the-menus-plan--what-they-left-open)

- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.**
  [Detail](backlog/catalogue.md#category-authoring-serialises-across-the-whole-database-and-nobody-has-measured-what-that-costs)

- **Extras list forms** (bundle of 6, size M). [Detail](backlog/catalogue.md#bundle-extras-list-forms)

- **Loose ends left by A343 (a menu's Price overrides tab tidied, #1368).** The Price overrides
  tab's save message comes after the whole table in tab order, so a keyboard user cannot reach Undo
  from a field within its 5 seconds (decided as built, not tested with a user).
  [Detail](backlog/catalogue.md#loose-ends-left-by-a343-a-menus-price-overrides-tab-tidied-1368)

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version** —
  owner, 2026-10-07; PR 1 landed (#2510), PRs 2–5 not started: the owner put them back on the
  backlog on 2026-11-09 ("it can go on the backlog"). PR 1 gave Undo for a menu's name, Home display,
  own section's name, photo or colour, and a dish's or one variant's price here, plus edit links
  on shared and included changes. Left for later (PRs 2–5): includes, products, sections, order and shortcuts.
  [Detail](backlog/catalogue.md#a353--previews-changes-an-undo-link-that-puts-one-change-back-to-the-live-version)

- **A1375 — A353's Undo: two rare ways a refusal is never shown** — a preview arriving between
  placing a refusal and the redraw, or a language switched off and on within one reload.
  [Detail](backlog/catalogue.md#a1375--a353s-undo-two-rare-ways-a-refusal-is-never-shown)

- **A1376 — The menu Preview's change list at 390 px: the last row runs under the box's edge** —
  not yet placed before or after #2510.
  [Detail](backlog/catalogue.md#a1376--the-menu-previews-change-list-at-390-px-the-last-row-runs-under-the-boxs-edge)

- **A1377 — A353's Undo: two wordings for the owner** — a deleted menu's price Undo, and a
  success line with two colons.
  [Detail](backlog/catalogue.md#a1377--a353s-undo-two-wordings-for-the-owner)

- **A1373 — The Preview credits a product's own price change seen through an include to the
  included menu**, not the shared product, when no menu sets a price of its own; telling it apart
  from an included menu clearing its price needs the published menu document to record where each
  live price came from.
  [Detail](backlog/catalogue.md#a1373--the-preview-credits-a-products-own-price-change-seen-through-an-include-to-the-included-menu)

- **The course dropdown says "— none —" where the folded Kitchen line says "Course: None
  specified"** (`product.no_course`, `modifiers.none_specified`,
  `apps/dashboard/src/i18n/strings.ts`) — left open by A211 (#1096).

- **Left open by #1188's review, none started** — the pricing unit dialog (W66, #1188).
  [Detail](backlog/catalogue.md#left-open-by-1188s-review-none-started-the-pricing-unit-dialog-w66)

- **A category's naming square does not announce the inherited colour's source.**
  [Detail](backlog/catalogue.md#a-categorys-naming-square-does-not-announce-the-inherited-colours-source)

- **From #541's review, neither blocking:** the product list shows a variant's blank price as its
  parent's with no marking (`apps/dashboard/src/widgets/product-list.ts`) — whether to grey it is
  the owner's call. [Detail](backlog/catalogue.md#from-541s-review-neither-blocking)

- **Dishes sold by measure and their extras** (bundle of 4, 2 important, size M). [Detail](backlog/catalogue.md#bundle-dishes-sold-by-measure-and-their-extras)

- **The extras form cannot pick a variant**, though the catalogue accepts one as an extras item
  (owner decision 2026-09-24): its picker lists top-level products only (`listProducts`). **Next
  action:** decide whether the picker should list variants.

- **Each unit literal** (bundle of 2, size S). [Detail](backlog/catalogue.md#bundle-each-unit-literal)

- **The combined end-to-end journey has not been walked**
  [Detail](backlog/catalogue.md#the-combined-end-to-end-journey-has-not-been-walked)

- **The picker collapses on `focusout` alone** (`#finishEditing`). If the editor is reported
  snapping shut mid-selection, make the collapse depend on `relatedTarget`.

- **The menu patch window: split the file first** (bundle of 9, size M). [Detail](backlog/catalogue.md#bundle-the-menu-patch-window-split-the-file-first)

- **A1150. Allergens and diet labels come from the live product on every screen** (owner,
  2026-10-27). Needs its own design before it is built. Today the till's menu and product info
  read them from the published menu version, while the kitchen screen, the table's allergy check
  and unsent table lines read the live product (`apps/server/src/line-nutrition.ts`). Sent till
  lines capture the live product at first sending under the owner’s 11-November A1517 decision 6,
  even while the counter still displays an earlier published declaration. So the live readers disagree
  until the menu is published again, and nothing says which is which. The owner chose one source,
  the live product, the way availability already works. The design covers every reader of a
  version's `allergens`, `dietaryDeclarations` and `diet`, the publish warnings and change list
  that compare them, and the guide's wording. The menu patch window (A1151)
  leaves allergens out because of this decision.

### Service periods, opening hours and departments

- **A1512. Send the venue's opening hours to Google (owner, 2026-11-11; was SP19).** Wanted. The
  hours and closures kept in Waitron update the venue's Google Business Profile, so Google Maps never
  shows a closed venue as open. Needs a design. Not started.

- **Department dialog** (bundle of 2, 1 important, size S). [Detail](backlog/service-periods.md#bundle-department-dialog)

- **One rule for two managers editing at once** (bundle of 6, 2 important, size M). Holds A1073. [Detail](backlog/service-periods.md#bundle-one-rule-for-two-managers-editing-at-once)

- **Seasons window** (bundle of 5, size S). [Detail](backlog/service-periods.md#bundle-seasons-window)

- **Period dialogs** (bundle of 4, size S). [Detail](backlog/service-periods.md#bundle-period-dialogs)

- **Service moment cost** (bundle of 2, size S). [Detail](backlog/service-periods.md#bundle-service-moment-cost)

- **Loose ends left by A755 (#1809).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a755-1809)

- **After A760: A877's one helper first** (bundle of 4, 1 important, size L, waits for another entry). [Detail](backlog/service-periods.md#bundle-after-a760-a877s-one-helper-first)

- **Loose ends left by A720.**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a720)

- **One rule for zone closures and department hours, after A760's opening_hours** (bundle of 8, size M, waits for the A1308 table hold to lift). The owner's answer: a closure outside its department's hours is ignored when read, and stops being an error. [Detail](backlog/service-periods.md#bundle-one-rule-for-zone-closures-and-department-hours-after-a760s-opening_hours)

- **Calendar marks** (bundle of 2, size S). [Detail](backlog/service-periods.md#bundle-calendar-marks)

- **Which name a record sent across a legal-name change carries** (A494 follow-up, 2026-10-11). A
  record keeps the name it was written with, so one written before the change but sent after it
  carries the old name, and a later cancellation of an earlier invoice carries the new one. Waits
  on the asesor's answer to Q37(d), S18 in `docs/compliance/asesor-questions.md`.

- **A department or zone delete's preview never counts a special day's painted hours**
  [Detail](backlog/service-periods.md#a-department-or-zone-deletes-preview-never-counts-a-special-days-painted-hours)

- **Holidays yearly** (bundle of 4, 1 important, size S). [Detail](backlog/service-periods.md#bundle-holidays-yearly)

- **A1084. A confirmed late dish routes by the period running when it is sent, not the period the
  kitchen agreed for**
  [Detail](backlog/service-periods.md#a1084-a-confirmed-late-dish-routes-by-the-period-running-when-it-is-sent-not-the-period-the-kitchen-agreed-for)

- **A1085. Extras added later to a dish sent after its period carry no mark.** An extras-only edit
  is priced as `ADDED_EXTRAS_ONLY` and skips the late check
  (`priceOrderLines`, `apps/server/src/working-order.ts`), so such an extra made at its own station
  prints and shows unmarked. Left open by A789 slice 3, #2051 (plan D25).


- **Opening the Year from a station's Week may keep `/station/<id>` in the address**, though the
  Year shows no station. Found by reading, not run — left open by A722 Part 3, #1834.

- **Painting stops short of an off-quarter-hour changeover**
  [Detail](backlog/service-periods.md#painting-stops-short-of-an-off-quarter-hour-changeover)

- **Two date helpers read years 0 to 99 as 1900 to 1999**
  [Detail](backlog/service-periods.md#two-date-helpers-read-years-0-to-99-as-1900-to-1999)

- **Refresh service settings on an open till**
  [Detail](backlog/service-periods.md#refresh-service-settings-on-an-open-till)

- **Split an order's recorded service mode into two facts (owner, 2026-10-09) — future work.**
  [Detail](backlog/service-periods.md#split-an-orders-recorded-service-mode-into-two-facts)

- **Compare computed station weeks with live routing on a painted special-day date without zone paint.**
  The slice 4 review read the planning and zone-week paths but did not compare the real sale
  resolver. Add a real-database comparison before claiming they agree on that case.

- **Smaller notes from the Hours reviews** — left open by the reviews of A261 step 5 (Hours, #1298):
  repeated-midnight clock choices still need checking.
  [Detail](backlog/service-periods.md#smaller-notes-from-the-hours-reviews)

### The kitchen and preparation

_Formerly the kitchen entries in the opening part of the old Track A (before A1), and kitchen entries elsewhere; part of A9._ Detail: [backlog/kitchen.md](backlog/kitchen.md).

- **What a kitchen card draws** (bundle of 3, 1 important, size S). Holds A1220. [Detail](backlog/kitchen.md#bundle-what-a-kitchen-card-draws)


- **Held paper followups** (bundle of 3, 1 important, size M). Holds A1066, A1369. [Detail](backlog/kitchen.md#bundle-held-paper-followups)

- **Supervisor station read** (bundle of 2, size S, needs the owner). Holds A1079. [Detail](backlog/kitchen.md#bundle-supervisor-station-read)

- **Browser tests still read `history.length` to tell whether a push happened, and Chromium stops
  it at 50**, so past that a test cannot see a push (`git grep -l 'history\.length;' -- '*.test.ts'`,
  Prep stations' older address cases among them). Move them to `pushState`/`replaceState` spies, as
  the retired-address tests do — left open by A506-12.


- **A930. The manager's overdue report counts a held dish as late (left open by A757 slice 3).**
  `computeOverdueOrders` (`packages/reporting/src/overdue-orders.ts`) never checks `fired_at`, so a
  dish held 20 minutes is listed Forgotten while the floor counts only fired dishes (A757 Q17). It
  also ages a dish waiting for the pass from its insert, where the pass ages it from its request.
  Decide whether the report leaves held dishes out too. [Detail](backlog/kitchen.md#a930-the-managers-overdue-report-counts-a-held-dish-as-late)

- **A1092. The kitchen screen once showed only some orders after a switch to Spanish.** Seen,
  2026-10-25 (A789 slice 4's look, `60` and `61` in `~/waitron-campaign-c/a789-4-shots/`): it showed
  orders #2 and #4 while the station's queue also held #1 and #7; a reload brought them back and a
  second switch did not lose them. Cause not found; that slice did not change the kitchen screen.

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group; printing
  problems).**
  [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)

- Left by C78's review: the earliest fire time is picked by comparing the stored times as text,
  right only while every writer stores the same `toISOString()` form.
  [Detail](backlog/kitchen.md#the-earliest-fire-time-is-picked-by-comparing-the-stored-times-as-text)

- **A pass printer must be added to each new station by hand.** A pass printer is now a printer
  listed on every station; a watcher set to follow every station used to cover a new station at
  once. Consider an "add to every station" control. Left open by A366 slice 5 Part B (decision P2).

- **Routing model reads** (bundle of 4, size M). [Detail](backlog/kitchen.md#bundle-routing-model-reads)

- **KDS corrections deferred from #191** — owner, 2026-09-01.
  [Detail](backlog/kitchen.md#kds-corrections-deferred-from-191)

- **Mark a new dish as urgent** — owner, 2026-09-27.
  [Detail](backlog/kitchen.md#mark-a-new-dish-as-urgent)

- **The dark-screen alert can be wrong** (S2b, owner, 2026-10-01).
  [Detail](backlog/kitchen.md#the-dark-screen-alert-can-be-wrong)

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

- **A1328. Older lines of the Spanish kitchen guide name markers Spanish kitchen paper does not print (seen in A803 slice 4b's look; predates it).** They say «marcada FIRE» and «HOLD CHANGED»
  where the paper prints `*** MARCHAR ***` and `EN ESPERA CAMBIADO`.
  [Detail](backlog/kitchen.md#a1328-older-lines-of-the-spanish-kitchen-guide-name-markers-spanish-kitchen-paper-does-not-print)

### The till, devices and table service

- **Service steps after a bill moves or tables combine** (bundle of 4, 2 important, size S). Holds A1330, A1331, A1333, A1005. [Detail](backlog/till.md#bundle-service-steps-after-a-bill-moves-or-tables-combine)

- **A Spanish invoice recipient's locality or province holding a comma is refused only at the
  server.** Left open by A1171 part 3.
  [Detail](backlog/till.md#a-spanish-invoice-recipients-locality-or-province-holding-a-comma-is-refused-only-at-the-server)

- **Remove till code nothing reaches** (bundle of 3, size M). Holds A1007. [Detail](backlog/till.md#bundle-remove-till-code-nothing-reaches)

- **Small till and floor wording fixes** (bundle of 8, size M). Holds A1259, A934, A920, A912, A470, A1106, A1107, A1108. [Detail](backlog/till.md#bundle-small-till-and-floor-wording-fixes)

- **A1052. A handheld's transfer accept list holds only counter zones.** Read, not run: a handheld
  fills it from `GET /api/default-service-zone/offers`, whose `zones` are the profile's counter
  zones (`apps/server/src/till-api.ts`); a till's holds every profile zone. Unchanged by A797 slice
  4 (its plan's D4).

- **Small till test renames** (bundle of 4, size S). Holds A1054, A1128. [Detail](backlog/till.md#bundle-small-till-test-renames)

- **A1421. Three till oddities seen once and not looked into.** At phone width the Downstairs
  bar's map is drawn tiny; a reload on a table's order lands on an empty order page; and a slow
  first read at sign-in leaves the PIN pad up with no sign of waiting.
  [Detail](backlog/till.md#a1421-three-till-oddities-seen-once-and-not-looked-into)

- **The till top bar fits at phone width, 1024 and 1280** (bundle of 9, 1 important, size M). Holds A1082, A921, A1219. [Detail](backlog/till.md#bundle-the-till-top-bar-fits-at-phone-width-1024-and-1280)

- **A1094. After a dialog is closed with Escape, the next till dialog draws a blue focus ring around
  the whole dialog** in the light theme; a first opening draws none. Seen, 2026-10-25 (A789 slice
  4's look, `06` and `08` against `33` in `~/waitron-campaign-c/a789-4-shots/`). I believe it is
  the shared dialog's keyboard-focus style reacting to the Escape key; not checked.

- **The owner's yes-or-no read: built defaults that wait only for a nod** (bundle, 2 important, size M, needs the owner). Holds A723, A762, A1059, A1060, A1063, A1067, A1068, A1080, A1081, A1250, A1253, A893, A936, A900, A923, A1011, A1020, A1031, A924, A925, A952, A953, A954, A956, A957, A958, A959, A292, A856, A859, A841, A841, A841. [Detail](backlog/till.md#bundle-the-owners-yes-or-no-read-built-defaults-that-wait-only-for-a-nod)


- **A803. Bills and tables: one portion per order line, one bill switcher, one picker (owner,
  2026-10-18).** Owner-approved design; A773-1 has landed. Slice 4c, Split a table through the same
  picker, has landed; it leaves open A1347–A1352, A1358–A1360, A1362, A1365 and A1366. Remaining: pre-bills through A446, which no longer
  waits for asesor S2.
  [Detail](backlog/till.md#a803-bills-and-tables-one-portion-per-order-line-one-bill-switcher-one-picker)

- **What happens after a split, and keeping the newest revision** (bundle of 7, size M). Holds A1347, A1348, A1352, A1362, A1365, A880, A1129. [Detail](backlog/till.md#bundle-what-happens-after-a-split-and-keeping-the-newest-revision)

- **Take over offered where it is needed** (bundle of 2, size M). Holds A1349, A1289. [Detail](backlog/till.md#bundle-take-over-offered-where-it-is-needed)

- **A1350. A row can read Paid on money a card in progress has only reserved (seen in A803 slice
  4c).** A bill holding only reserved money draws no paid words in its header, but its rows say
  `Paid` (`bill_pay.paid`) or "{amount} is already paid on this bill" (`table.move_dishes_floor`),
  because `paidQuantitiesOf` counts pending item payments. The row's words came with slice 4a.
  [Detail](backlog/till.md#a1350-a-row-can-read-paid-on-money-a-card-in-progress-has-only-reserved)

- **A1358. A number stepper's − and + are 24 by 32 px, against the 44 px tap size (seen in A803
  slice 4c's LOOK; predates it).** Measured on Split a table's guest steppers at 390 wide. The
  buttons are `wt-number-stepper`'s, which 4c did not change, so every form using it has them.

- **Table screen panels that do not fit** (bundle of 3, size S). Holds A1359, A1265, A1290. [Detail](backlog/till.md#bundle-table-screen-panels-that-do-not-fit)

- **A1360. The demo's Counter device says "This device isn't set up — ask to join this venue" under
  the Demo banner (seen in A803 slice 4c's LOOK).** On every screen after sign-in. The words are
  main's (`apps/till/src/i18n/codes.ts`); why it shows was not looked into.

- **The pay window, after A739** (bundle of 4, 2 go-live, 2 important, size M, waits for another entry). Holds A1191, A1266, A1300, A1291. [Detail](backlog/till.md#bundle-the-pay-window-after-a739)

- **One answer to "where is this order"** (bundle of 3, size S, needs the owner). Holds A1235, A1032, A678. [Detail](backlog/till.md#bundle-one-answer-to-where-is-this-order)

- **A1237. The English till's "dishes not served" window showed the reason «No servido» (seen in
  A803 slice 2's LOOK, on the demo venue).** Not traced: it may be the demo venue's own reason
  name rather than a till string. Believed to predate the slice; not run on main.

- **A1261. A full invoice for a bill already paid, from the table's ⋮ (left open by A803 slice 3,
  Owner question 2, #2360).** Once A802 gives the till a way in, offer it from the ⋮ for a paid
  bill.
  [Detail](backlog/till.md#a1261-a-full-invoice-for-a-bill-already-paid-from-the-tables-)

- **A bill another till moved, merged or part-paid** (bundle of 2, 1 important, size M). Holds A1267, A1288. [Detail](backlog/till.md#bundle-a-bill-another-till-moved-merged-or-part-paid)

- **A1269. A dead-end question that replaces another keeps the first one's picks (found in A803
  slice 3's LOOK fix review 3; predates it, `c8487cba5`).** Clear both when the question changes.
  [Detail](backlog/till.md#a1269-a-dead-end-question-that-replaces-another-keeps-the-first-ones-picks)

- **A1416. A started or served dish whose option was renamed blocks every save of its order until
  it is cancelled (left open by A1382).** Run on main for a started dish, and in R3-fixes for a
  served one; not small, since it needs a decision on what a
  started dish's saved answer means.
  [Detail](backlog/till.md#a1416-a-started-or-served-dish-whose-option-was-renamed-blocks-every-save-of-its-order-until-it-is-cancelled)

- **A1417. After a lost counter Send reply, a basket changed since cannot be sent and the till says
  only try again (left open by A1382).** A sentence failed review because not every change can be
  undone; the proposal is to lock the basket while the answer is unknown.
  [Detail](backlog/till.md#a1417-after-a-lost-counter-send-reply-a-basket-changed-since-cannot-be-sent-and-the-till-says-only-try-again)

- **A till request refused for naming someone not signed in locks the screen with no sentence (left
  open by A1382).** #2534 built the check on every such request; the owner's words are not in yet.
  [Detail](backlog/till.md#a-till-request-refused-for-naming-someone-not-signed-in-locks-the-screen-with-no-sentence)

- **Other till sentences still send the person to somebody else, against the refusal rule (left open
  by A1382).** Listed by code in the detail.
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

- **A1030. Firing one held dish is refused on a merged-in party's paid bill (found by A758-7).**
  `fireHeldLine` (`apps/server/src/order-groups.ts`) looks for the dish only among bills whose
  `party_id` is the table's own party.
  [Detail](backlog/till.md#a1030-firing-one-held-dish-is-refused-on-a-merged-in-partys-paid-bill-found-by-a758-7)

- **What an open till picks up from a setup change** (bundle of 3, 1 important, size S). Holds A785, A787. [Detail](backlog/till.md#bundle-what-an-open-till-picks-up-from-a-setup-change)

- **An element inside a shadow root attached after a drag starts keeps its own cursor rule during
  that drag** — left open by A642.
  [Detail](backlog/till.md#an-element-inside-a-shadow-root-attached-after-a-drag-starts-keeps-its-own-cursor-rule-during-that-drag)

- **The "Goes with" line** (bundle of 4, size S). [Detail](backlog/till.md#bundle-the-goes-with-line)

- **Delete the tests and fixtures that still set `fireControl` with A1301 S28 (left open by A773-2
  PR D, its plan's D113).** Nothing reads the setting; tests still pass it to the till's setup
  answer or write the `fire_control` column, and they pass.
  [Detail](backlog/till.md#delete-the-tests-and-fixtures-that-still-set-firecontrol-with-a1301-s28)

- **Pass board code and missing test pins** (bundle of 3, size M). [Detail](backlog/till.md#bundle-pass-board-code-and-missing-test-pins)

- **Status words on the pass and beside it** (bundle of 6, size S). [Detail](backlog/till.md#bundle-status-words-on-the-pass-and-beside-it)

- **A station move of dishes from several stations prints each station's slips in an order that
  can change between runs (left open by A773-2 B3's reviews; predates it).** `moveDishesToStation`
  groups dishes by station from a select with no `orderBy`. Order it, so tests can compare slips
  in order.

- **Segmented choices still break words when whole words cannot fit (left by A773-2 B4b).** Decide
  whether such a control should stack its choices instead.
  [Detail](backlog/till.md#segmented-choices-still-break-words-when-whole-words-cannot-fit-left-by-a773-2-b4b)

- **Custom item on the Counter (A738 residual; undecided).** The dashed + Custom item tile and its
  window remain unbuilt. The window needs a name, price, required VAT rate and destination
  (nowhere or a station). Decide the permission and whether an underlying product supplies the
  catalogue, reports and invoice-line identity before building an arbitrary-price path.
  [Detail](backlog/till.md#custom-item-on-the-counter-a738-residual)

- **A666 — A floor join that moves tables together is sent once without seats and refused before
  the Seats prompt opens (2026-10-14; owner decided 2026-10-17).** It first sends the merge or
  join with no seat count, gets `400 merge.seats_required`, then opens the Seats prompt and sends
  again. Owner, 2026-10-17: ask for the seat count first and send once; the other refusals (table
  not free, already grouped, zone mismatch) then show only after the seats are typed. Done when a
  floor join that needs seats asks for them before its first request and sends once.
  [Detail](backlog/till.md#a666-a-floor-join-that-moves-tables-together-is-sent-once-without-seats)

- **Do not offer a closed area as a destination** (bundle of 2, size S). [Detail](backlog/till.md#bundle-do-not-offer-a-closed-area-as-a-destination)

- **A730 — The floor's Rename window may keep comparing against the name it opened with after the
  name is changed on another till (2026-10-15; open; found by reading in A717's review, not probed).**
  **Next action:** probe it in real Chromium; if Save compares against the old name, follow the
  stored name as `party-name-dialog.ts` does.
  [Detail](backlog/till.md#a730-the-floors-rename-window-may-keep-comparing-against-the-name-it-opened-with)

- **A559. The till's full-invoice dialog changes width when an error appears.** Left open by A231q.
  [Detail](backlog/till.md#a559-the-tills-full-invoice-dialog-changes-width-when-an-error-appears)

- **Failed refreshes with nowhere to go** (bundle of 2, size S). [Detail](backlog/till.md#bundle-failed-refreshes-with-nowhere-to-go)

_Formerly A4; part of A9._ Detail: [backlog/till.md](backlog/till.md).

- **Loose ends left by the comments sweep (#604–#623).** Found while pruning comments.
  - Split-off checks may reach the same path as a held-order edit that changes sent lines (#623).
    Nothing tests two `openTab` calls racing on one table or concurrent rounds landing on
    consecutive line numbers (the sequential versions are in `tabs.test.ts`).
    [Detail](backlog/till.md#split-off-checks-may-reach-the-same-path-as-a-held-order-edit-that-changes-sent-lines)
  - "resets any leftover drill/active tab on login" still passes with login's own clearing line
    deleted (#621). Should the `no-meat`/`no-fish` lenses also hide a dish whose diet is still
    pending review, as `vegan`/`vegetarian` do?
    [Detail](backlog/till.md#resets-any-leftover-drillactive-tab-on-login-still-passes-with-logins-own-clearing-line-deleted)
  - Test titles repeat claims the branch corrected (#618, `apps/till` `src/api` + `src/state` +
    `src/i18n`). [Detail](backlog/till.md#test-titles-repeat-claims-the-branch-corrected-618)
  - Test titles repeat claims the branch corrected (#616, `apps/till/src/widgets`). A courseless
    section the server held shows its lines greyed with no fire button (`#fireAction` in
    `station-queue.ts`, from #131).
    [Detail](backlog/till.md#test-titles-repeat-claims-the-branch-corrected-616)
  - The till always mounts the counter screen `embedded` (#614). In device mode the station
    screen's `#reload` swallows a `device.unauthorized`, so a device cookie revoked mid-session
    raises nothing until the next connect.
    [Detail](backlog/till.md#the-till-always-mounts-the-counter-screen-embedded)
  - Two `v8 ignore start` comments in `till-sale.ts` (`finalizeCapture`, `finalizeSettle`) cite
    `provider.ts:66-83` (#613). The checker compares tool comments character for character, so
    repointing them to `PaymentResult` in `packages/payments/src/provider.ts` is not a
    comments-only change.
    [Detail](backlog/till.md#two-v8-ignore-start-comments-in-till-salets-finalizecapture-finalizesettle-cite-providerts66-83)
  - UI package notes (#604): the remaining image-list and coverage-config observations need
    checking against the current tree.
    [Detail](backlog/till.md#ui-package-notes-left-by-the-comments-sweep)

- **Bookings loose ends** (bundle of 3, size S). [Detail](backlog/till.md#bundle-bookings-loose-ends)

- **Cash handed back for a voided cash sale is recorded nowhere** — OPEN (found 2026-09-24 by #605).
  A void writes no payment or refund row, so if staff give a customer cash back, the void's day
  shows a drawer shortfall at cash-up. **Owner decision 2026-09-25:** keep it here and decide it
  when the till's void screen is designed.
  [Detail](backlog/till.md#cash-handed-back-for-a-voided-cash-sale-is-recorded-nowhere)

- **How a unit and its quantity read** (bundle of 2, 1 important, size S). [Detail](backlog/till.md#bundle-how-a-unit-and-its-quantity-read)

- **On the till, opening a section from lower on the screen leaves the page scrolled**, so the
  breadcrumb is out of view. I believe this predates W93: neither `main`'s nor W93's
  `apps/till/src/widgets/menu-browser.ts` scrolls on opening a section (read, not bisected). Left
  open by W93 (#1287).

- **Loose ends left by A429 slice 5.** Tighten the till's `TableState.today` type: slice 5 keeps it
  nullable for now (`apps/till/src/api/client.ts`), even though the floor's in-service read requires
  today's row.
  [Detail](backlog/till.md#loose-ends-left-by-a429-slice-5)

- **Loose ends left by A718.**
  `wt-floor-plan-preview` has no product user. Retire it, or record why it is kept.
  [Detail](backlog/till.md#loose-ends-left-by-a718)

- **One rule for a booking when the evening's layout changes** (bundle of 3, 1 important, size M, needs the owner). Holds A474, A550, A857. [Detail](backlog/till.md#bundle-one-rule-for-a-booking-when-the-evenings-layout-changes)

- **Floor map drag, hidden map, allergy mark** (bundle of 4, size S). [Detail](backlog/till.md#bundle-floor-map-drag-hidden-map-allergy-mark)

- **Show a table's short name where the full name does not fit** (bundle of 4, 3 important, size S, needs the owner). Holds A561, A562, A1101. [Detail](backlog/till.md#bundle-show-a-tables-short-name-where-the-full-name-does-not-fit)

- **Joined-table writers keep their rows right** (bundle of 2, size M, waits for another entry). Holds A592, A594. [Detail](backlog/till.md#bundle-joined-table-writers-keep-their-rows-right)

- **One rule for what holds a table back at a reset** (bundle of 3, 1 important, size M, waits for another entry). Holds A565, A566, A860. [Detail](backlog/till.md#bundle-one-rule-for-what-holds-a-table-back-at-a-reset)

- **A turned floor plan table narrower than its unturned box stops short of the plan's left or top
  edge.** An 8 × 4 turned 90° stops 2 squares from the left edge, because its saved corner cannot
  go below 0. Owner question asked 2026-10-16; (a), keeping it so, is built. Left open by A672.
  [Detail](backlog/till.md#a-turned-floor-plan-table-narrower-than-its-unturned-box-stops-short-of-the-plans-left-or-top-edge)

- **Two forms not yet on the Forms contract** (bundle of 2, size S). [Detail](backlog/till.md#bundle-two-forms-not-yet-on-the-forms-contract)

- **Floor plan editor at phone width** (bundle of 3, size S). Holds A1103, A1109. [Detail](backlog/till.md#bundle-floor-plan-editor-at-phone-width)

- **Guest-facing QR, online ordering, delivery, online booking** (bundle of 4, size L, waits for another entry). Holds A508, A509, A1012, A1013. [Detail](backlog/till.md#bundle-guest-facing-qr-online-ordering-delivery-online-booking)

- **A1513. Take orders from the delivery apps: Glovo, Uber Eats, Just Eat (owner, 2026-11-11).**
  After go-live, not at it. Today staff would type each app order into the till by hand. Needs a
  design, including whether to connect each app or one service that gathers them all. Not started.

- **A1514. Share bookings with TheFork and Reserve with Google (owner, 2026-11-11).** Later: Waitron's
  own booking system, including online booking (A1013), works first. Without it, a venue taking
  bookings in both places can double-book a table. Not started.

- **Loose ends left by A429 slice 1 (#1493).**
  The bookings list shows no table for any booking, and a past booking's kept table name
  (`bookings.table_label`) is stored but shown nowhere.
  [Detail](backlog/till.md#loose-ends-left-by-a429-slice-1-1493)

- **One measuring pass over the till at 390 and 1024** (bundle of 8, 2 important, size M). [Detail](backlog/till.md#bundle-one-measuring-pass-over-the-till-at-390-and-1024)

- **A436 — a kitchen display with someone signed in, logged out only after a long idle time** (owner,
  2026-10-08, answering the A366 slice 5 plan; open). The owner: "kitchen
  displays can have a login, but i would not expect them to log off automatically, or at least
  only after an extended logout time (eg 30 minutes)". Today nobody can sign in on one. Left out
  of slice 5 as too large for it.
  [Detail](backlog/till.md#a436--a-kitchen-display-with-someone-signed-in-logged-out-only-after-a-long-idle-time)

- **A kitchen display forgets its chosen language on a reload** (seen 2026-10-27 in A797 slice 9's
  LOOK; open).
  [Detail](backlog/till.md#a-kitchen-display-forgets-its-chosen-language-on-a-reload)

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group).**
  - A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
  - Every pass press moves the party's revision, so a waiter's open table screen meets
    `party.out_of_date` after it and reads again.

- A line outside any group that needs no kitchen, held, and first released after its bill was paid
  could not be marked served (`group.line_held`), because `stampSent` wrote `sent_at` only on an
  open bill. Since B21 (#969, core `0053`) `stampSent` writes on any bill but an abandoned one;
  whether this case is now served was not measured. Left open by service Task 9 (#814, served by
  quantity, release reminders, Current orders).

- **Loose ends left by service Task 11 (#916, cancellations, comps and discounts; B11a–B11g).**
  The adjustment history records who approved, but not whether the bill's comp limit or the refund rule,
  rather than the reason, is why.
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **Loose ends left by service Task 16 (#981, counter handover).**
  A collect straight after Place order does not re-read the kitchen queue.
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **Loose ends left by service Task 17 (#991, a table that leaves without paying).**
  Collecting PART of the debt later is not built. Collecting it in full uses
  `POST /api/working-orders/:id/collect`.
  [Detail](backlog/till.md#task-17-991-a-table-that-leaves-without-paying)

- **Reads and saves with no time limit** (bundle of 2, size S). [Detail](backlog/till.md#bundle-reads-and-saves-with-no-time-limit)

- **Loose ends left by the table actions plan (Tasks 8, 10 and 11, #869, #875, #881; C77/C86;
  C84).**
  [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)

- **Later: optional seat/guest item assignment (owner, 2026-09-20).** Include shared items when this
  is designed. For now, orders remain at table/tab level and staff select items manually when
  splitting bills; seat assignment is not a prerequisite for the service workflow.

- **Later: staff-to-table assignments (owner, 2026-09-20).** Design assigning responsibility for
  tables to staff, including handover and how assignments appear on the floor dashboard. The current
  workflow discussion assumes no assignments; they are not a prerequisite for the dashboard.

- **Diet badges still read undeclared caution and success text colours.** A668-5 removes the basket
  and kitchen reads from the original “Four till surfaces ask for a caution colour” finding.
  [Detail](backlog/till.md#diet-badges-still-read-undeclared-caution-and-success-text-colours)

- **The three displays walked end to end** — [ui-review.md](ui-review.md)'s areas, at the real box,
  as part of walking the box with the printers; with the owner present, after 2 November (owner,
  2026-10-17).

- **Qualify printer identity at enrolment.** The device enrolment design's separate printer track remains. [Detail](backlog/till.md#bundle-printer-identity-at-enrolment)

- **Malformed sale and cancellation bodies answer 500.** With an authenticated, permitted till,
  `POST /api/sales` with `{}` or `{"lines": []}`, and
  `POST /api/working-orders/:id/cancel` with `{}`, answered `500 server.internal` in A941's
  HTTP probe. Validate the missing fields and assert the domain refusal.
  [Detail](backlog/till.md#malformed-sale-and-cancellation-bodies)

- **A1102. The till's tests name tables in Spanish.** `apps/till/src/till-app.test.ts`'s counter
  move cases use "Mesa 9" and "Mesa 7", and many other till test files use "Mesa …" labels (`git
  grep -l '"Mesa ' -- 'apps/till/src/*.test.ts'`), against the English-only rule (CLAUDE.md §3).
  [Detail](backlog/till.md#a1102-the-tills-tests-name-tables-in-spanish)

- **A1105. At 390 px in English the till's Ready bar hides its last entry under "Open ›".** Seen,
  2026-10-25 (the A797 slice 1 look, `e-bar-dining-390-light-en.png` in
  `~/waitron-campaign-c/a797-1-shots/`): with three entries the last, "W1 · 1", is cut off by the
  "Open ›" button and the bar scrolls sideways to reach it; in Spanish all three fit
  (`e-bar-dining-390-light-es.png`).
  [Detail](backlog/till.md#a1105-at-390-px-in-english-the-tills-ready-bar-hides-its-last-entry-under-open-)

- **A1112. The server, the API and a configuration file still accept a "+" in a short name.** The
  dashboard's floor plan editor refuses a "+" in a short name it would save, unless the table
  already had it stored (`refusesPlus`, `apps/dashboard/src/screens/floor-plan-draft.ts`; A797 slice
  2), because the till writes tables joined for today as "T1+T2".
  [Detail](backlog/till.md#a1112-the-server-the-api-and-a-configuration-file-still-accept-a--in-a-short-name)

- **A1209. A help tooltip near the window's foot covers its own "?".** Seen, 2026-10-29 (A1125's
  look, `g-phone-help-390-*` in `~/waitron-campaign-c/a1125-shots/`); left open by A1125, #2238.
  [Detail](backlog/till.md#a1209-a-help-tooltip-near-the-windows-foot-covers-its-own-)

- **Nothing covers the order screen's bar** (bundle of 2, size S, needs the owner). Holds A1211, A1212. [Detail](backlog/till.md#bundle-nothing-covers-the-order-screens-bar)

- **A1140. Splitting a counter order delivered to a table leaves the new bill with no delivery
  table.** Left open by slice 8b (its plan's D3): copy the delivery table on a split.
  [Detail](backlog/till.md#a1140-splitting-a-counter-order-delivered-to-a-table-leaves-the-new-bill-with-no-delivery-table)

- **Does "made here" belong to the device or to its profile? (A270, owner 2026-10-04) — OPEN.** It
  is a per-device setting by the 2026-10-01 decision
  ([routing design §5.11](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md)); under
  the 2026-10-04 profile model a "Bar till" profile could carry it instead. Needs an owner decision.
  [Detail](backlog/till.md#does-made-here-belong-to-the-device-or-to-its-profile-a270-owner-2026-10-04--open)

- **Each browser tab as its own device, in Demo too (A271, owner 2026-10-04) — OPEN, after A268.**
  Only dev mode lets a tab act as a separate device, and it names the device by id alone
  (`x-waitron-dev-device`, `apps/server/src/device-session.ts`); the sign-in cookie is shared by the
  whole browser. **Next action:** a short spec for per-tab device secrets and per-tab sign-ins
  usable in Demo, and reproduce the owner's report first.
  [Detail](backlog/till.md#each-browser-tab-as-its-own-device-in-demo-too-a271-owner-2026-10-04--open-after-a268)

- **Close the day: count the cash, record cash in and out, waiter floats** (bundle of 3, 2 go-live, 1 important, size L, design approved 2026-11-06, waits for A1308's payment and refund slices). Holds A1325. [Detail](backlog/till.md#bundle-close-the-day-count-the-cash-record-cash-in-and-out-waiter-floats)

- **The till's four choice dialogs (`apps/till/src/widgets/`) each carry their own radio-option
  styles, which could be one shared set** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.

- **Loose ends left by W97 (#1311).**
  - A card payment stuck `attempting` holds its device's profile switch until a manager resolves
    it on Payments. The till only says to switch once it finishes; point it at the Payments screen.
    [Detail](backlog/till.md#a-card-payment-stuck-attempting-holds-its-devices-profile-switch)
  - The till's Profile button shows whenever the device has more than one approved profile, read
    at boot: neither approvals added later nor the signed-in person's admission hide or show it
    until the dialog reads `/api/device/me` again.
    [Detail](backlog/till.md#the-tills-profile-button-shows-whenever-the-device-has-more-than-one-approved-profile)
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

- **A899. design-system.md's "Retheming a deployment" gives the wrong reason against a bare
  `[data-wt-theme-root]` selector (`docs/developers/design-system.md:108-110`, written when the file
  was created in b20c26709).** Next: reword the sentence with the real reasons.
  [Detail](backlog/till.md#a899-design-systemmds-retheming-a-deployment-gives-the-wrong-reason-against-a-bare-data-wt-theme-root-selector-docsdevelopersdesign-systemmd108-110-written-when-the-file-was-created-in-b20c26709)

- **Refresh the floor without a staff action in a zone's list view — OPEN (3d, W16).** — left
  open by the product folders work. Since A429 slice 3 the floor screen re-reads the floor every
  15 seconds while a zone's map is on screen. Polling would read `listTablesWithState` every few
  seconds on every till; choose the interval and cost first.
  [Detail](backlog/till.md#refresh-the-floor-without-a-staff-action-in-a-zones-list-view--open-3d-w16)

- **The till's menu reads (Task 7, #719).** — left open by the menus plan. The basket comparison
  does not notice a publish that adds a required options list to a dish in the basket, or lowers a
  list's picks limit, so the till takes the new version silently and the server then refuses
  `options.label_required` (or `extras.limit_exceeded`): staff see a refusal where the dialog should
  have asked. [Detail](backlog/till.md#the-tills-menu-reads-task-7-719)

- **The till's home page (Task 9, #729).** — left open by the menus plan. Search matches the staff
  name only, not a customer name. The till also searches displayed section names (A461).
  [Detail](backlog/till.md#the-tills-home-page-task-9-729)

- **Reopening a held order keeps its lines right** (bundle of 5, 1 important, size S). [Detail](backlog/till.md#bundle-reopening-a-held-order-keeps-its-lines-right)

### Printers, the print agent and receipts

_Formerly A3, A8 and B6; part of A9._ Detail: [backlog/printers.md](backlog/printers.md).

- **The sales screen's "no printer" note sends staff to a manager.** `sales.no_printers`
  (`apps/dashboard/src/i18n/strings.ts`, English and Spanish; shown by
  `apps/dashboard/src/screens/dashboard-sales-screen.ts:605`) says "Ask a manager to add one under
  Printers.", against CLAUDE.md §3's rule that a refusal never sends the person to somebody else.
  Say what adding a printer does and link Printers, or offer the sign-in there (found by A1301 S19).

- **A print agent somewhere other than the box** (bundle of 4, size L, waits for another entry). Holds A1203, A1204, A1175. [Detail](backlog/printers.md#bundle-a-print-agent-somewhere-other-than-the-box)

- **Department receipt preview** (bundle of 2, size S). [Detail](backlog/printers.md#bundle-department-receipt-preview)


- **Show a failed automatic invoice copy to staff.** A recoverable email or office-printer
  reservation refusal commits the sale with no delivery row or paper fallback; the diagnostic
  is in the server log. Decide how the till should show that outcome and offer another copy.
  [Receipt-branch observation](backlog/printers.md#show-a-failed-automatic-invoice-copy-to-staff)

- **One session at the real box: printers, paper, tax QR, the drawer** (size M, needs the real hardware and inbox). Holds A739, A773, A552, A553. [Detail](backlog/printers.md#bundle-one-session-at-the-real-box-printers-paper-tax-qr-the-drawer)

- **Printing does not wait for discovery** (bundle of 5, 2 important, size M). [Detail](backlog/printers.md#bundle-printing-does-not-wait-for-discovery)

- **Bluetooth pairing commands** (bundle of 5, 1 important, size M). [Detail](backlog/printers.md#bundle-bluetooth-pairing-commands)

- **Cross-box print-agent TLS** — an agent trusts only its local box CA, so a mirror's agent cannot
  reach the primary; gates the mirror's print agent (_Afterwards_). The vouch slots into the same
  route later.

- **Waitron carries two QR encoders; consolidate on `qrcode-generator`** — Small.
  [Detail](backlog/printers.md#waitron-carries-two-qr-encoders-consolidate-on-qrcode-generator)

- **Since W72c an imported print agent arrives with no node; the importing box's own agent still
  enrols as a new row beside it**, as it did before (read, not run). Left open by W72c (#1237).

- **The printer's stuck alert counts what the table counts** (bundle of 3, size S). [Detail](backlog/printers.md#bundle-the-printers-stuck-alert-counts-what-the-table-counts)

- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
  Finished jobs are to be kept one month (owner, 2026-10-14). [Detail](backlog/printers.md#the-virtual-pdf-printer)

- **Reprint kitchen tickets and other printouts laid out again for any printer (left open by A405
  point 4, #2678)** — needs a `print_jobs` column.
  [Detail](backlog/printers.md#reprint-kitchen-tickets-and-other-printouts-laid-out-again-for-any-printer)

- **A Used by link to a prep station opens the Stations tab, not the station (left open by A405).**
  [Detail](backlog/printers.md#a-used-by-link-to-a-prep-station-opens-the-stations-tab-not-the-station)

- **Guest count** (bundle of 2, size S, needs the owner). [Detail](backlog/printers.md#bundle-guest-count)

- **A790. Remaining document and printer choices.** Orderless historical F1 Invoice delivery,
  dashboard routing and its separate browser preference remain open. Keep the mixed-printer
  payment choice and Devices-table A4 marker in this item. A739’s order-linked till prerequisite
  is released by the [till document/printer slice](superpowers/plans/2026-11-09-a790-till-document-printer.md);
  its payment window comes before the combined A840/A842/A848 change. G4/A947, recovery-origin
  file, browser journal, prepare/accept and duplicate-print protection are dropped. Landed
  foundations grant no cleanup authority; fiscal issuance and F2 replacement stay outside A790.
  [Detail](backlog/printers.md#a790-document-and-printer-routing-plan)

- **Loose ends left by A661 (#1745).**
  [Detail](backlog/printers.md#loose-ends-left-by-a661-1745)

- **Receipt layout pass** (bundle of 4, 1 important, size M). Holds A960, A961, A1201. [Detail](backlog/printers.md#bundle-receipt-layout-pass)

- **One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still
  open:**
  [Detail](backlog/printers.md#one-receipts-settings-page-with-a-live-preview-c116-989-c120-1000-c121-996--still-open)

**Left open, for the owner, by C113 (#1014, one receipt language per location):**

- **Receipt language loose ends** (bundle of 5, size S). [Detail](backlog/printers.md#bundle-receipt-language-loose-ends)

### Payments and card readers

- **A1089: charged-but-unsettled and repeated payment-check failures need a recovery route.** Trace the existing pending-payment recovery and reason-specific messages, then offer only confirmed-outcome actions. Never retry a charge or unlock an unknown outcome.
  [Audit](backlog/self-service-refusals.md#payments).

_Formerly A6, and the old Track C's payments items; part of A9._ Detail: [backlog/payments.md](backlog/payments.md).

- **A742 — the guest types what they pay, and a tip (owner, 2026-10-15; on the backlog, NOT to be
  queued yet).** A flow where staff hand the device to the customer, who enters how much they want
  to pay of the bill and optionally adds a tip, then hands it back or pays on the reader. Builds on
  A739's payment window (An amount) and the bill payments design's tips. Not designed.



- **Stripe adapter upkeep** (bundle of 5, size S). [Detail](backlog/payments.md#bundle-stripe-adapter-upkeep)

- **A846's points for the owner at land: held card payments.** A kept payment has no invoice, the
  held alert comes back at midnight UTC, and smaller choices from the plan, the browser look and the review. Each stays open until the owner
  answers it. [Detail](backlog/payments.md#a846s-points-for-the-owner-at-land-held-card-payments)

- **The reconciler's card reversal records only after the provider call, with a fresh key each time.**
  Next: give the reconciler's reversal the same durable-attempt rule.
  [Detail](backlog/payments.md#the-card-refund-path-records-only-after-the-provider-call-with-a-fresh-key-each-time)



- **A875. Check two writes the bill payments design says a pending card refund refuses.**
  Next: one route case each during a pending refund, then fix the design's wording, or the code
  if a move can change what a bill charges (ask the owner first). Read, not run.
  [Detail](backlog/payments.md#a875-check-two-writes-the-bill-payments-design-says-a-pending-card-refund-refuses)

- **The SumUp Solo experiments.** Still open after the 9 November cross-account session: signature-required
  cards, declined-card behavior, the statement/fee check, remaining connection
  probes and a second standalone machine sample. The reported decimal-`0.40` probe refunded the
  full payment, but its request bytes were not saved and the cause is unknown.
  No further paid request unattended.
  [Detail](backlog/payments.md#the-sumup-solo-experiments)

- **The deli's outage card machine.** Buy the standalone machine and
  replace estimated prices with real quotes.
  [Detail](backlog/payments.md#the-delis-outage-card-machine)

- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race); Stripe's reader list is one page; status never refreshes by
  itself, and polling must go through the passive-session controller.

- **The SumUp reconciler** — settlement-report audit and orphan self-heal. A949 also includes
  durable reversal attempts (W44) and the owner's backup-machine matching contract. The November
  results now include cross-account affiliate acceptance, pending/paid references, REFUNDED events
  and unpaid cancellation. The first recovery slice supplies Waitron's partner key and records
  identified refunds; manager release of a partial-refund hold, report audit, orphan self-heal,
  durable reversals and backup-machine
  matching remain to build.
  [Detail](backlog/payments.md#the-sumup-reconciler)

- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.

- **Tap to pay restore** (bundle of 1, size M, needs the owner). [Detail](backlog/payments.md#bundle-tap-to-pay-restore)

- **A user guide for the till's payment sheet** (left open by A796). No guide under
  `apps/server/src/guide/` covers it.


- **A796 does not hold a bill across phones while a payment is out.** The hold is the phone's own:
  "no new payment … can be started on that bill from this phone" (A796 design §4, "The phone loses
  Wi-Fi mid-payment", and default 7). The server is unchanged, so another phone can start a
  payment on the same bill meanwhile.

- **A payment whose read shows it settled the bill needs one press of Comprobar de nuevo to show
  the ticket.**
  [Detail](backlog/payments.md#a-payment-whose-read-shows-it-settled-the-bill-needs-one-press-of-comprobar-de-nuevo-to-show-the-ticket)

- **No fiscal venue paid flow** (bundle of 2, size S). [Detail](backlog/payments.md#bundle-no-fiscal-venue-paid-flow)

- **Some card payments ask the cardholder to sign instead of enter a PIN — open question, nothing
  built.** Start by reading what the SumUp Solo actually does on a signature-required card,
  because if the reader owns the whole step there may be nothing for us to build.
  [Detail](backlog/payments.md#some-card-payments-ask-the-cardholder-to-sign-instead-of-enter-a-pin--open-question-nothing-built)

- **A793 — tips: who a tip belongs to, how it is shared out, and what payroll gets** — NOT
  APPROVED: the owner (2026-10-18, on Q38): "Leave this for now. Back to the backlog. It needs a
  bigger brainstorm." Next: that brainstorm with the owner, before any build or further question.
  [Detail](backlog/payments.md#a793--tips-who-a-tip-belongs-to-how-it-is-shared-out-and-what-payroll-gets)

- **Three small tip display gaps** (found by A793's design, read): the dashboard's order detail
  shows a bill payment's applied amount without its tip; the card slip's words are fixed Spanish;
  and the Spanish refund slip says "Propina" where the English says "Tip returned".
  [Detail](backlog/payments.md#three-small-tip-display-gaps)

- **Reader status time limits** (bundle of 2, size S). [Detail](backlog/payments.md#bundle-reader-status-time-limits)

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

- **A1227. Check screens that add live subscriptions after an awaited read.**
  [Detail](backlog/dashboard.md#a1227-check-screens-that-add-live-subscriptions-after-an-awaited-read)

Detail: [backlog/dashboard.md](backlog/dashboard.md).

- **Form implementation leftovers:** shared plumbing, an untraced dialog focus line and eventual summary retirement. [Detail](backlog/dashboard.md#bundle-form-implementation-leftovers)




- **A1069. Venue settings keeps a `kitchen` tab key with no panel (owner question).** The key in
  `VENUE_SETTINGS_TABS` (`apps/dashboard/src/screens/venue-settings-screen.ts`) lets the page's tab
  checks keep a second tab; say if it should go (about 25 cases then lose their subject) — plan
  A756 PR 8 Decision 10.

- **A398 — device-profile editor heading remains to align with the sub-page pattern.**
  [Detail](backlog/dashboard.md#a398--device-profile-editor-heading-remains-to-align-with-the-sub-page-pattern)

- **`setEmail` in `packages/identity/src/staff.ts`, unlike `updatePersonDetails`, never checks the
  new email against other people's pending emails**
  [Detail](backlog/dashboard.md#setemail-in-packagesidentitysrcstaffts-unlike-updatepersondetails-never-checks-the-new-email-against-other-peoples-pending-emails)

- **Wt dialog lifecycle** (remaining: caret keys, menu/modifier/media repeated-key checks, covered-dialog reinsertion, wrappers, modifier picker and coverage leftovers). [Detail](backlog/dashboard.md#bundle-wt-dialog-lifecycle)

- **Should an all-archived product selection show Archive greyed out rather than hidden?**
  Left open by W110c (#1271); A435-1 removes Enable and keeps Archive hidden for that selection.

- **Design system doc truth** (bundle of 1 remaining entry, size S). [Detail](backlog/dashboard.md#bundle-design-system-doc-truth)

- **Override PIN limits (C89, #951), for the owner** — **Next action:** the owner decides whether to
  add the countdown and make the limit required. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **One session with real phones and password managers** (bundle of 13, 3 go-live, 7 important, size M, needs the real hardware). [Detail](backlog/dashboard.md#bundle-one-session-with-real-phones-and-password-managers)

- **What C38 left as it was (a generated display name is the first given name and first surname,
  #827, owner decision 2026-09-28).**
  [Detail](backlog/dashboard.md#what-c38-left-as-it-was-a-generated-display-name-is-the-first-given-name-and-first-surname-827-owner-decision-2026-09-28)

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)**
  [Detail](backlog/dashboard.md#every-login-failure-is-one-answer-c95-930-owner-decision-2026-09-30)

- **Review every permission: fewer, coarser, and consistently named**
  [Detail](backlog/dashboard.md#review-every-permission-fewer-coarser-and-consistently-named)

- **A1002: access roles and job roles.** [Approved redesign, 2026-11-11](superpowers/specs/2026-11-11-a1002-roles-redesign-design.md)
  replaces the 7 November design: access roles are ticked permission lists, several per person,
  combined; job roles drive the rota and device sign-in and grant nothing. The
  [build plan](superpowers/plans/2026-11-11-a1002-roles-redesign.md) starts with test-fixture
  preparation, now ready: ordinary people and device-profile fixtures use the shared helpers.
  SQL constraint, trigger and pinned-hash probes retain their direct writes until PR11.
  Legacy raw SQL role reads remain for PR11. Access/job-role behavior remains to be built.
  Cut 1's permission names (#2578) have landed.
  [Detail](backlog/dashboard.md#roles-are-something-an-admin-can-add-and-edit-the-four-built-ins-are-only-defaults)

- **Shared database-backed table paging, search and sorting** (owner decision 2026-09-12; users
  first). 50 per page with a server-enforced maximum; search and sort over the whole dataset;
  debounce, reset on filter change, ignore superseded responses, keep passive live refreshes.
  [Detail](backlog/dashboard.md#shared-database-backed-table-paging-search-and-sorting)

- **Tell people by email when their account's security changes** (owner, 2026-09-12): password changed,
  passkey or authenticator added or removed, recovery codes regenerated, email changed, Google login
  connected or disconnected. No link, one line on what to do if it was not them. Open: notify the OLD
  address on an email change; wording when an admin made the change; grouping a burst.

- **Permission-based dashboard navigation** (owner, 2026-09-09; `NAV_GROUPS` in
  `apps/dashboard/src/dashboard-app.ts` mostly uses role checks): map every built-in destination to
  its server permission, hide unavailable items and empty groups, same rule for direct URLs and the
  landing screen.

- **The admin's Edit user form has no Language** chooser; a person's `locale` can only be set on Your
  profile.

- **Typed values are only partly checked — a generic phone-format check landed, a country-specific
  one has not.**
  [Detail](backlog/dashboard.md#typed-values-are-only-partly-checked--a-generic-phone-format-check-landed-a-country-specific-one-has-not)

- **Slow key derivation off the main thread** (bundle of 5, 3 important, size M). [Detail](backlog/dashboard.md#bundle-slow-key-derivation-off-the-main-thread)

- **Nothing stops the next screen styling `wt-data-table` cell markup with a class.** A check that
  compares the class names a screen's own stylesheet styles against the class names it puts inside
  `wt-data-table` cell callbacks looks feasible; nobody has tried to write it. Left open by product
  categories (#340).

- **Other browser check** (bundle of 4, size S). [Detail](backlog/dashboard.md#bundle-other-browser-check)

- **The new key and passkey icons draw lines at width 2** while the change-account icon beside them
  uses 1; the card copies the setup wizard's card styles rather than sharing `wt-card`, and nothing
  keeps the two in step. Left open by A191 (the dashboard's sign-in pages, #1074; owner to decide).

- **Modifiers' Status and Printers' Agent/Printer Status filters still receive column lists built
  during render** (A370 caller audit, code reading only). Their redraw work was not measured in this
  item. Next: measure it before deciding whether to retain those lists. Left open by A370 (#1393).

- **A deployment that overrides `--wt-color-primary` or `--wt-color-danger` by hand keeps Waitron's
  default hover, text and disabled colours, and no theme writes the danger ones**
  [Detail](backlog/dashboard.md#a-deployment-that-overrides---wt-color-primary-or---wt-color-danger-by-hand-keeps-waitrons-default-hover-text-and-disabled-colours)

### Interface languages

_Formerly entries spread across the old sections, C125 among them; part of A9._ Detail: [backlog/languages.md](backlog/languages.md).

- **Ui wording sweep** (bundle of 7, 1 important, size M). [Detail](backlog/languages.md#bundle-ui-wording-sweep)

- **Native speaker review** (bundle of 3, size S, needs a third party). [Detail](backlog/languages.md#bundle-native-speaker-review)

- **Regional languages** (bundle of 3, size L, needs the owner). C125, the staff screens in every
  official language, is off hold (owner, 2026-11-08). Extend the setup working-language choices and
  starter translations beyond English and Spanish here. [Detail](backlog/languages.md#bundle-regional-languages)

### Alerts, logging and diagnostics

_Formerly A5, and the logging part of A9._ Detail: [backlog/alerts.md](backlog/alerts.md).

- **Still not built: a standby that has fallen behind** — left open by "Dashboard alerts and the
  incidents surface" (A5, LANDED #363/#368/#371).

- **A low-battery alert (A272, idea, 2026-10-04) — OPEN.** A268 shows each device's battery on the
  Devices list; nothing alerts when a handheld runs low.

- **A982. Logging Slice 2 — one-touch bug report.** Dashboard and setup browser-only preview/download
  is implemented by the [download-first plan](superpowers/plans/2026-11-08-a982-client-only-report-first.md).
  Till buttons, richer trail privacy and stored capture with manager read/download remain;
  stored capture needs its own plan. Cloud forwarding and automatic crash/freeze reporting are separate.
  [Detail](backlog/alerts.md#logging-diagnostics--one-touch-bug-report-a9-slice-1-landed-192).

- **A1047. Send a problem report to Waitron Cloud (owner, 2026-10-24).** The follow-up A982
  leaves open.
  [Detail](backlog/alerts.md#a1047-send-a-problem-report-to-waitron-cloud).

- **A1048. Opt-in automatic error reports to Waitron Cloud (owner, 2026-10-24: "Should be opt
  in").** Setup asks plainly, unticked; settings can change it.
  [Detail](backlog/alerts.md#a1048-opt-in-automatic-error-reports-to-waitron-cloud).

- **Alerts text display** (bundle of 2, 1 important, size S). [Detail](backlog/alerts.md#bundle-alerts-text-display)

### Working time and staff

_Formerly A10; part of A9._ Detail: [backlog/workforce.md](backlog/workforce.md).


- **Staffing reads the day start in force on each date** (bundle of 3, 1 important, size M, needs the owner). Holds A851, A644, A708. [Detail](backlog/workforce.md#bundle-staffing-reads-the-day-start-in-force-on-each-date)

- **A780. The staffing painters read holder names they never show (left open by #1828).**
  [Detail](backlog/workforce.md#a780-the-staffing-painters-read-holder-names-they-never-show-left-open-by-1828).

- **Staffing month day box** (bundle of 2, size M, waits for another entry). Holds A763. [Detail](backlog/workforce.md#bundle-staffing-month-day-box)

- **A link look for `wt-button` (left open by #1841).**
  [Detail](backlog/workforce.md#a-link-look-for-wt-button-left-open-by-1841)

- **Wages / labour cost (SP16).** Gated on the labour advisor; not fiscal.
  [Detail](backlog/workforce.md#wages--labour-cost-sp16).

- **Inspector remote access to working-time records.**
  [Detail](backlog/workforce.md#inspector-access-to-working-time-records).

- **Have the labour advisor check working-time exports before go-live.**
  [Detail](backlog/workforce.md#advisor-review-of-the-working-time-export).

- **Payroll export waits for the gestoría's import format.**
  [Detail](backlog/workforce.md#payroll-export-and-unused-scheduling-tables).

- **Give the built close step a caller, then its cadence rule** (bundle of 2, 1 important, size M, needs the owner). [Detail](backlog/workforce.md#bundle-give-the-built-close-step-a-caller-then-its-cadence-rule)

- **Audit attendance discovery invalidation for late attribution and rule changes.** A direct-insert
  experiment finds activity that becomes attributable after its initial scan without dirtying its day;
  route reachability is unverified. [Detail](backlog/workforce.md#attendance-discovery-invalidation).

- **Read attendance facts by the requested day.** Narrow the source queries in
  `apps/server/src/attendance-facts.ts` while preserving late corrections, original request times
  and pending payment outcomes.

- **Workforce period reads still load complete history.** Narrow them without losing late or
  cross-period corrections; retain the new latest-instant and person-scoped reads. The remaining query paths are in
  [workforce detail](backlog/workforce.md#a10-period-read-cost).

- **Loose ends left by A585-7 (#1766).**
  [Detail](backlog/workforce.md#loose-ends-left-by-a585-7-1766).

- **Staffing painter shared parts** (bundle of 2, size M). Holds A699, A711. [Detail](backlog/workforce.md#bundle-staffing-painter-shared-parts)

- **A700. A failed Opening hours read also hides the Calendar's other views.**
  [Detail](backlog/workforce.md#a700-a-failed-opening-hours-read-also-hides-the-calendars-other-views).

- **A701. Opening hours' month reads the holiday tables twice on a holiday-linked special day.**
  [Detail](backlog/workforce.md#a701-opening-hours-month-reads-the-holiday-tables-twice-on-a-holiday-linked-special-day).

- **Colour chooser placement** (bundle of 2, size S). [Detail](backlog/workforce.md#bundle-colour-chooser-placement)

- **The Rota shift routes read a null or malformed JSON body as an empty object.**
  [Detail](backlog/workforce.md#the-rota-shift-routes-read-a-null-or-malformed-json-body-as-an-empty-object)

- **A707. On a phone, a paint grid's block menu or Copy to… chooser can cover the block it belongs to.**
  [Detail](backlog/workforce.md#a707-on-a-phone-a-paint-grids-block-menu-or-copy-to-chooser-can-cover-the-block-it-belongs-to).

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

- **A1187 part 2: the recovery pack's emergency start page (owner, 2026-10-29).**
  Waits for A1188 part 1, whose card facts the page prints, for people holding `node.promote`.
  [Detail](backlog/box.md#a1187-part-2-the-recovery-packs-emergency-start-page-owner-2026-10-29).

- **A1187 part 3: the recovery pack's disk key page.** B3's development startup now creates and retains the key through `scripts/box/disk-key.mjs`; the protected host delivery and pack integration remain to be built. A pack
  that cannot carry the disk key is refused rather than drawn without it.
  [Design](superpowers/specs/2026-10-29-a1187-one-recovery-pack-design.md), [how part 1 leaves room](superpowers/plans/2026-10-29-a1187-recovery-pack-part-1.md#how-part-1-leaves-room-for-parts-2-and-3).

- **What pack part 1's reviews left** (bundle of 10, 3 important, size M). Holds A1187, A1187, A1187, A1187, A1187, A1187, A1187, A1187, A1187, A1187. [Detail](backlog/box.md#bundle-what-pack-part-1s-reviews-left)

- **One word for the box, one name for the key** (bundle of 4, 2 important, size S, needs the owner). Holds A1187. [Detail](backlog/box.md#bundle-one-word-for-the-box-one-name-for-the-key)

- **There is no Backups guide page**, so the Backups screen and its Recovery pack card link to none.

- **Backups screen leftovers** (bundle of 9, 1 important, size M). [Detail](backlog/box.md#bundle-backups-screen-leftovers)

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

- **Backups offers no administrator sign-in when it refuses for lack of `system.manage`.** It says
  "You don't have permission to do that" twice and names no next step.
  [Detail](backlog/self-service-refusals.md#backups-admin-sign-in)

- **Public TLS repair refuses linked layouts.** Healthy linked `tls/` folders still serve HTTPS,
  but a damaged linked folder or managed file cannot be repaired through the public guide. The
  public page offers retry, Check again and Stop; repairing a damaged linked layout remains open.
  [Detail](backlog/box.md#public-tls-repair-refuses-linked-layouts)

- **Till changes do not check which page sent them.** OPEN (left open by A1371, #2507). The till and
  device cookies are `SameSite=Strict`, which ignores the port, and the server-wide page check
  judges only changes carrying the dashboard's cookie; a fix needs a till-side list of trusted pages.
  [Detail](backlog/box.md#till-changes-do-not-check-which-page-sent-them)

- **Full disk: the till read that fails, and the words** (bundle of 13, 4 important, size M). [Detail](backlog/box.md#bundle-full-disk-the-till-read-that-fails-and-the-words)

- **Migrating a box drops the change-feed triggers one statement at a time, outside a
  transaction.**
  [Detail](backlog/box.md#migrating-a-box-drops-the-change-feed-triggers-one-statement-at-a-time-outside-a-transaction)

- **The Amazon S3 delete and archive rehearsal's open edges (A538-9).** Left open by #1668, in
  `apps/server/src/testing/` (`aws-request-recorder.ts`, `s3-delete-scenario.ts`,
  `s3-archive-scenario.ts`) and the runbook `docs/developers/aws-backup-rehearsal.md`.
  [Detail](backlog/box.md#the-amazon-s3-delete-and-archive-rehearsals-open-edges-a538-9)

- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
  The same B2 bundle holds the remaining restore carry-forwards, including placement durability.
  [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **Guide replacement address settings after a cold restore.** Replace manual configuration of
  the advertised origin and dashboard origin/passkey domain with a recovery step that checks they
  match the replacement's address.
  [Detail](backlog/box.md#guide-replacement-address-settings-after-a-cold-restore)

- **A1483. Run natively on ARM before go-live.** The owner asked for ARM support on 10 November, then deferred it until go-live is near because ARM builds are slow.
  The published image and B3 installer currently support amd64 only.
  [Detail](backlog/box.md#a1483-native-arm-image-and-installer-before-go-live)

- **B3. The bootable USB installer** — read-only network display on Box status; controls and release gates remain; design approved with changes; [six-slice plan](superpowers/plans/2026-10-26-b3-usb-installer.md).
  The owner authorised the build on 2026-11-01, one pull request at a time; [PR 1](superpowers/plans/2026-11-01-b3-1-encrypted-disk.md) (#2370) adds three host libraries under `scripts/box/`, none called yet. PR 2 (#2423, [plan](superpowers/plans/2026-11-03-b3-2-preboot-logic.md)) adds the preboot unlock gate with the proposed 2/4/8/16/32/60-second wait, the locked-mode redirect decision and the Wi-Fi record reader under `scripts/box/`, none called yet. PR 3 (#2426, [plan](superpowers/plans/2026-11-03-b3-3-installer-policy.md)) adds the installer's decisions and its network fallback decisions under `scripts/box/`, none called yet; the signed release list waits for A940's release slices and a chosen signature format. PR 4 (#2430, [plan](superpowers/plans/2026-11-03-b3-4-name-tag-wifi-copy.md)) defines the name tag (a LUKS2 token of Waitron's own type), its decoder, the finder and a write plan, and the Wi-Fi boot copy's writer and its write-or-why-not decision, under `scripts/box/`, none called yet. PR 5 (#2432, [plan](superpowers/plans/2026-11-03-b3-5-wifi-publication.md)) adds the Wi-Fi boot copy's publisher under `scripts/box/`, none called yet: it writes the copy through a flushed staging file, removes it on every "no copy" answer, refuses an unverified boot mount or an unsafe folder or file name with no write, and reports the copy's state. PR 6 (#2433, [plan](superpowers/plans/2026-11-03-b3-6-disk-key-letters.md)) adds the disk recovery key's conversion between 32 bytes and systemd's 64 letters, and reading a typed key back, under `scripts/box/`, none called yet. PR 7 (#2474, [plan](superpowers/plans/2026-11-05-b3-7-host-protocol.md)) adds the box host protocol under `scripts/box/`, whose request writer and reply reader PR 8's client calls (its answer function is called by nothing yet): seven of B3's requests as checked one-line requests with an ids-only actor, their checked replies, and an answer function that calls injected adapters and never puts a Wi-Fi password in a reply, a log entry or another adapter's argument; the clock requests stay on slice 9b's shell handler. PR 8 (#2495, [plan](superpowers/plans/2026-11-06-b3-8-host-client.md)) adds the server's client for those seven requests in `apps/server/src/box-host-client.ts`, called by nothing until PR 9: typed answers, never a throw, and a box with only the clock handler read as not taking them. PR 9 ([plan](superpowers/plans/2026-11-06-b3-9-host-routes.md)) builds it in `boot.ts` and answers six of those requests through routes behind `system.manage`, with the signed-in person as the actor; the development name-tag duty is now bound.
  The [host network read](superpowers/plans/2026-11-12-b3-19-network-status.md) connects the protected API to the installed NetworkManager. Network controls, scan/join/forget and boot-copy reconciliation remain open.
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

- **Automatic upgrades with rollback until a clean, running restart (A950)**: go-live (owner, 2026-11-09): "it's required for go live and needs to be bullet proof." The owner adopted the shorter route of a fresh review on 2026-11-09, adding a real test sale on the copy to its step 3; the [two-group plan](superpowers/plans/2026-11-09-a950-shorter-upgrades.md) is approved (owner, 22:04), with Lane F building the first group after A739 and A840/A842/A848. Build steps 2/3/4/8 first: safe manual copy/restore, readiness with a real copy-sale, online trial and install-fix-now. They wait on no other project. Steps 1/5/7/6 are later: signed releases, automation, status/email and pairs. It includes A799's trial on a copy of the live data. Earlier: [design approved 29 October](superpowers/specs/2026-10-27-a950-automatic-upgrades-design.md), [plan approved 29 October](superpowers/plans/2026-10-29-a950-automatic-upgrades.md).
  After the first venue: the Cloud release check, the password-checked go-back button, proof-of-close, and the backup-stream handoff.
  The first group will protect manual upgrades using current data; it has host status/logs, with new status/email in the later group. Later automation defaults to an editable **03:00–05:00 local** window, 10 quiet minutes and no open orders. Automatic activation waits for signed releases and the reporting-capable baseline. Ordinary Linux/Docker copies do not require btrfs. Successful readiness checks close rollback before business work resumes. Every copy-sale must pass, even on a same-reason source refusal. Failed manual attempts offer restore/keep; only failed automatic attempts restore without asking. Manual repair preserves open orders while stopping new work and draining active effects. The owner accepts no email when both versions fail to start.
  Earlier cuts 1–2 add isolated settings, dated-window, bounded-discovery, attempt-journal and startup-decision libraries. After cancellation, discovery waits for one immediate callback and one timer callback before deciding whether to retry; unfinished work keeps the discovery slot. Its fake-clock cancellation and cooperative-deadline tests wait for each attempt and deadline before advancing time. The cancellation test checks that this synchronisation leaves its fake clock unchanged. The cooperative cases also cover an adapter admitted on the next event-loop turn. Both fixture groups abort and await their discovery in `finally`; forced-assertion controls leave the following discovery able to run. The separate uncooperative-timeout fixture still needs `finally` cleanup that settles its deliberately non-cancelling adapter after a failed assertion. The journal uses a fixed-root injected IO boundary, retains terminal history, and keeps interrupted publication under inspection; startup decisions grant no trading permit. Reopening an incomplete freeze requires durable abandonment. JournalIo reserves `.turn` inside the namespace for its future adapter. No production verifier, hold or journal IO adapter, installed updater or timer calls them. The new plan replaces the remaining twelve-cut roadmap; later release trust remains an A940/B3 dependency; paired upgrades need a new A947 hold/completion/recovery decision, not merely its existing waiting/follower/promotion code. Cloud, close receipts and backup-stream handoff no longer gate the first-venue route. All real runtime qualification remains UNVERIFIED / NOT RUN.
  [Detail](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order)

- **Finish the clock work: a check at every start and every change** (bundle of 3, 1 go-live, 2 important, size L, waits for another entry). Holds A798. [Detail](backlog/box.md#bundle-finish-the-clock-work-a-check-at-every-start-and-every-change)

- **One steady-clock helper instead of hand-written clock-step-back guards** (owner, 2026-11-01,
  answering #2331). Many timers, throttles and watches across the packages and apps each guard by
  hand against the wall clock stepping back (for example `packages/identity/src/pin-throttle.ts`,
  `apps/server/src/backup-schedule.ts`, `packages/fiscal-verifactu/src/drain.ts`). Move them onto one
  shared helper that measures elapsed time on a steady clock. Start by listing every site
  (`git grep -n -i -E "went backwards|step(s|ped)? back|backward"` outside tests) and the rule each
  applies today; behaviour is kept site by site. Raised by #2331's review, not yet designed.

- **AEAT's time for a confirmation comes from its QR validation host, not from a `consultar` reply.**
  [Detail](backlog/box.md#aeats-time-for-a-confirmation-comes-from-its-qr-validation-host-not-from-a-consultar-reply)

- **The start on a full disk deletes backups by stamp alone after a clock step.**
  [Detail](backlog/box.md#the-start-on-a-full-disk-deletes-backups-by-stamp-alone-after-a-clock-step)

- **Closing a pay period trusts the box's clock.**
  [Detail](backlog/box.md#closing-a-pay-period-trusts-the-boxs-clock)

- **A1268 part 2: pair a person's entries by write order after a backward clock step.** [Detail](backlog/box.md#a1268-part-2-pair-a-persons-entries-by-write-order-after-a-backward-clock-step)

- **Bucket copy: silent stops and a real outage** (bundle of 5, 2 important, size S). [Detail](backlog/box.md#bundle-bucket-copy-silent-stops-and-a-real-outage)

- **A second confirmation naming the same record while the first's alerts are open records no
  second alert.** The bell keys an open alert by the named record's sale, so the second folds into
  the first; `clock_confirmations` and the Box status page keep both. Left open by A798-B slice 9
  (#2025).

- **After a 'disproved' alert, the confirmation still covers and later sales are not added to the
  alert.** Its `{to}` is the latest sale when the disproof was seen; sales made afterwards on the
  same clock appear in no alert. Whether a disproof should stop payments again is for the owner
  (slice 9 decision 14). Left open by A798-B slice 9 (#2025).

- **Qualify clock confirmation through remote access** (bundle of 2, 1 important, size M). [Detail](backlog/box.md#bundle-qualify-clock-confirmation-through-remote-access)

- **A1407. A wrong date needs a corrective invoice, and Waitron cannot yet issue the right one.** Research found the remedy is R4 on a full invoice and R5 on a simplified one, and `recordCorrection` handles only F2 to R5. `computeVatReturn` sorts by issue date, so a misdated sale lands in the wrong period in that report. Three identical refusals hold the rest of a chain, so a clock a day ahead could stop later filings; a record refused for a future date should get its corrective at once, naming the refused invoice, which AEAT's developer FAQ §17 says resolves it (case 2.a) and AEAT's test service accepted for an R1 (verifactu run 37286368370). Clocks running behind are not listed for the owner. The invoices to correct are those AEAT refuses as dated in the future (`1112`), already stored on the filing record; a wrong date AEAT accepts is not corrected (owner, 2026-11-10; A1420 D8). An enabled remedy takes the start gate first: today the remedies write past it, and production enables none (A1420 R7). AEAT's `TimestampPresentacion` is read but not stored: kept with each record, it would prove the real time of most sales, and that part needs a column, so it waits for the A1308 table hold to lift. Read, not run. [Findings](compliance/research/2026-11-06-adviser-clock.md)

- **Correct the sales dated wrongly once the tax adviser answers Q60.** What the correction is
  waits on [Q60](compliance/asesor-questions.md#q60-sales-dated-later-than-the-real-time-by-a-clock-that-ran-ahead-added-2026-10-24);
  A1088 built only the list, the handled lists, the note and the download. Left open by A1088.

- **Wrongly dated sales list and the adviser's file** (bundle of 7, 2 important, size M). [Detail](backlog/box.md#bundle-wrongly-dated-sales-list-and-the-advisers-file)

- **The bell's printer check reads every print job.**
  [Detail](backlog/box.md#the-bells-printer-check-reads-every-print-job)

- **Card reader alerts** (bundle of 2, 2 important, size S). [Detail](backlog/box.md#bundle-card-reader-alerts)

- **Does a SumUp Solo that is on but idle report itself offline?** The owner's unused Solo read
  `OFFLINE` (slice 10 plan P11), and SumUp's client maps anything but `ONLINE` to offline, so if an
  idle Solo does the same, the bell carries a standing `reader.offline` warning. For the owner to
  check against the reader. Left open by A798-B slice 10.


- **Box status rows** (bundle of 4, 1 important, size S). [Detail](backlog/box.md#bundle-box-status-rows)

- **Refuse folders that cannot be safe** (bundle of 1, size S). [Detail](backlog/box.md#bundle-refuse-folders-that-cannot-be-safe)

- **A transaction opened outside the write queue can let a body's writes after a full disk
  commit.**
  [Detail](backlog/box.md#a-transaction-opened-outside-the-write-queue-can-let-a-bodys-writes-after-a-full-disk-commit)

- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on every log line — the connection-string shape and nothing else. [Detail](backlog/box.md#the-recovery-pages-secret-bound-is-a-convention-not-a-guard)

- **Resetting a box without a terminal** — owner, 2026-10-02. Wanted: a reset offered on the dashboard, and probably on the recovery page as well, because a box that will not start is the one an operator most wants to reset. Open: who may press it (the owner only?), and whether a reset started from inside the app container can remove the Docker volumes the script removes, or has to empty them instead. [Detail](backlog/box.md#resetting-a-box-without-a-terminal)

- **Creation/provisioning `dayCutover` still needs input validation.** The W6 review (#1104) passed `"24:00"` and `"99:99"`
  through `planVenue`; both emerged with seconds appended. **Next action:** choose the validation
  boundary and a domain refusal, then test invalid values before they reach storage.

- **A venue preparing to go live sends real email through SMTP (A987) — BUILD.** Prepare now
  requires SMTP outside development and uses it for account and invoice email. Settings lets admins
  save and remove the relay, with manager reads and actionable SMTP tests. Users and Account settings
  distinguish queued, captured and unconfigured account mail, and an immediate invitation
  retry says when nothing changed. Ordinary SMTP and Settings tests use the venue sender name.
  Demo captures account mail, reminders and alerts outside development even with a stored relay.
  Left: Cloud delivery, gated on D102.
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

- **A1018. Simple controlled and emergency handover, with Cloud only a placement.** M2 handles all AEAT communication after either takeover; returning M1 transfers fiscal originals, outcomes and their recorded payment facts without replaying live effects.
  The [build plan](superpowers/plans/2026-11-02-a1018-handover-build.md) cuts the work into slices.
  The controlled Servers-to-spare screen is built and checked on simulated boxes; real-box use
  still waits for real-box qualification. Slice 7’s emergency server flow is checked on simulated
  boxes. Slice 8 adds the protected `/handover/emergency` page, saved-declaration resume and the
  existing clock check, with one entered password/code retained until completion or leaving and a
  replacement code only if it expires. Its [page plan](superpowers/plans/2026-11-12-a1018-8-emergency-page.md)
  was cleared by the watcher on 12 November; real-box and Cloud qualification remain open. Slice 12a will derive unknown intervals from the signed
  declarations in `handover_activations.evidence`, without separate gap tables in Slice 7.
  The owner answered (a) to both its questions (returned invoices in modelo 303; the emergency
  minute wait) on 2026-11-02: Slice 12b is built on that answer, landed by the owner and marked
  pending the venue's tax adviser, and Task 7.4b is not built. On 2026-11-03 the owner read
  Slice 9's S2 re-run from its new Parts F and G, and S2 reads PASS; Slices 10 and 11 may be built.
  [Detail](backlog/replication-cloud.md#a1018-agree-and-build-the-hosted-writer-stop-proof-contract)

- **A947 3b must make the held chart vouch for a joined box's key, or the main box can never check
  its answer and waits at every start.** Left open by A1018 Slice 3 (Ruling R13).
  [Detail](backlog/replication-cloud.md#a947-3b-must-make-the-held-chart-vouch-for-a-joined-boxs-key-or-the-main-box-can-never-check-its-answer-and-waits-at-every-start)
  A947 also owns the spare's authenticated switch screen (watcher, 2026-11-08); the spare's
  dashboard is retired. [Decision](backlog/replication-cloud.md#decisions-and-deliberate-limits).

- **The boot peer reconcile cannot reach a real box's certificate.** Found by A1018 Slice 3's
  review.
  [Detail](backlog/replication-cloud.md#the-boot-peer-reconcile-cannot-reach-a-real-boxs-certificate)

- **A captured signed peer query can be replayed later to read a box's status, or a stepped-down box's indicator and final copy.** The peer-status
  route checks the query's `atMs` but never uses it, so there is no freshness window; a strict one
  would lock out a box with a wrong clock. Owner's choice. Left open by A1018 Slice 3 (Ruling R6).

- **The waiting start's stuck and stale cases** (bundle of 3, 2 important, size S). [Detail](backlog/replication-cloud.md#bundle-the-waiting-starts-stuck-and-stale-cases)

- **Size and attempt limits on box-to-box and handover routes** (bundle of 2, 2 important, size S). [Detail](backlog/replication-cloud.md#bundle-size-and-attempt-limits-on-box-to-box-and-handover-routes)

- **Check everything at the offer, while the old box still sells** (bundle of 3, 1 go-live, 1 important, size M, waits for another entry). [Detail](backlog/replication-cloud.md#bundle-check-everything-at-the-offer-while-the-old-box-still-sells)

- **Which state files a handover carries; summary checks** (bundle of 2, 1 important, size S, waits for the A1308 table hold to lift). [Detail](backlog/replication-cloud.md#bundle-which-state-files-a-handover-carries-summary-checks)

- **A venue with no module that can prepare a promotion cannot hand over.** A venue without
  Veri\*Factu is refused `handover.venue_not_supported` before anything is recorded, because no
  plan yet builds its path, including whose invoice series the new main box takes. A947 3b's table
  expects Slice 5 to reach these venues. Left open by A1018 Slice 5 (Ruling P9).

- **A1342: remaining returned-record clashes and facts.** Invoice, chain-position and correction
  clashes still need an acceptance rule, pending the owner's answer. Exact payment-clash acceptance
  is an internal API; sale lines, reprints, the returned-invoices reporting marker and real-box
  qualification remain open. A filing result held only by the old box is not applied to a record
  already on the new main; a late payment on an older box's chain is not included in this return.
  [Detail](backlog/replication-cloud.md#a1342-return-a-stopped-boxs-records-before-reset)

- **A third box's chart can leave another box serving-secondary and filing.** The remaining
  third-box cases from A1342 need their own approved scope; the owner accepted the two-box bucket
  stop as clearing A947 3b-6 on 2026-11-09. [Detail](backlog/replication-cloud.md#a-box-the-chart-no-longer-names-main-keeps-filing-its-earlier-records)

- **Series and module-preparation gaps at handover** (bundle of 3, 2 go-live, 1 important, size M, waits for another entry). [Detail](backlog/replication-cloud.md#bundle-series-and-module-preparation-gaps-at-handover)

- **Decide what the old promote route still does** (bundle of 3, 2 important, size S). Holds A1279. [Detail](backlog/replication-cloud.md#bundle-decide-what-the-old-promote-route-still-does)

- **Two safe handover states stay open for good.** A box handed a fencing chart between the role and
  its record, then killed, stays restricted at `filing_assumed`; one handed it between the venue save
  and the role, then killed, stays a mirror holding an activation row and its own SIF. Neither sold
  or filed in the runs, and no route clears them. Left open by A1018 Slice 5.

- **A stepped-down old box answers a sale with a plain 404, so a till shows a generic "try again".**
  It is safe (the till does not read the outcome as unknown), but "try again" keeps failing until the
  new box is switched on; the stepping-down window just before answers 503 with its own words. Left
  open by A1018 Slice 5.

- **The spare's wait loop: back-off, reasons, stop signals** (bundle of 7, 3 important, size M, waits for another entry). [Detail](backlog/replication-cloud.md#bundle-the-spares-wait-loop-back-off-reasons-stop-signals)

- **No test holds "M1 is restricted before, during and after" at every state.** It is true now, but
  nothing holds it at `return_pending`, `return_complete` or `replaced`. Due before Slices 10 and 13
  add code that changes those states. Left open by A1018 Slice 5.

- **Remaining handover refusal wording.** Codes whose words name no next step,
  words false at the stage they appear, and the "Unreadable" settings, each for Slice 6 to settle as
  its screens first show them. Left open by A1018 Slice 5.
  [Detail](backlog/replication-cloud.md#slice-6s-list-the-handover-words-no-screen-shows-yet)

- **A1185: a venue not yet connected sees no prices.** Left open by A1185.
  [Detail](backlog/replication-cloud.md#a1185-a-venue-not-yet-connected-sees-no-prices)

- **A1418. A box records how it stopped, and a replaced box stays stopped (owner, 2026-11-07).** One
  admin action takes a box out of service with a full, checked backup; a shutdown waits for an admin
  at the next start, a power cut waits a minute, a restart does not wait.
  [A1418 design](superpowers/specs/2026-11-07-a1418-box-stop-intent-design.md), approved 2026-11-07; plan next.

- **A1425. Every restore takes its own identity (owner, 2026-11-07).** A restored box still
  keeps the old box's identity. Part 3 makes a restore a takeover, after Cloud agrees to change the
  rule that a restore keeps the old box's identity. Part 2, a staff route that cancels a sale, is
  built only if a venue needs one before go-live.
  [Design](superpowers/specs/2026-11-07-restore-takes-new-identity-design.md), approved 2026-11-07.

- **A1188. Someone at the venue can start the venue in the cloud when the box has died (owner,
  2026-10-29).** Part of A1018 and Cloud's P6. Design approved 2026-10-29. Building waits for
  A947's strip and Cloud's half:
  [A1188 design](superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md).
  [Detail](backlog/replication-cloud.md#a1188-someone-at-the-venue-can-start-the-venue-in-the-cloud-when-the-box-has-died-owner-2026-10-29)

- **The till's theme fetch does not follow a server move (A841 slice 3).** The till fetches
  `/api/theme` from the page's own address, not through `ServerRouter`; moved to another server, it
  would keep the theme it has, or take the old server's while that one still answers, so failover
  work must route it ([conventions-ui.md](developers/conventions-ui.md)).

- **Recheck that a spare gets later charts** (bundle of 2, 1 important, size S, waits for another entry). [Detail](backlog/replication-cloud.md#bundle-recheck-that-a-spare-gets-later-charts)

- **Re-read old failover lists after 3b, delete what it retired** (bundle of 6, 3 important, size M, waits for another entry). [Detail](backlog/replication-cloud.md#bundle-re-read-old-failover-lists-after-3b-delete-what-it-retired)

**The on-prem mirror.** Read this section as requirements slices 3–5 must meet, not as work
outstanding on code that exists.

- **A1321. Retire a dead or reset spare from Servers.** The
  [reduced design](superpowers/specs/2026-11-08-a1321-retire-spare-design.md) was owner-approved on 8 November; the
  [one-page plan](superpowers/plans/2026-11-08-a1321-retire-spare.md) has watcher approval (2026-11-09 10:27);
  reduced scope extends Remove with server-checked declarations and the existing audit.
  Build waits for A947 3b-6; no new start check or returning-key trust path.
  [Detail](backlog/replication-cloud.md#a1321-retire-a-dead-or-reset-spare-from-servers)

- **A947. Go-live on two local boxes.** The owner approved the revised design. Slice 3b's build
  plan is written (eleven pull requests; Q1 is the owner's); 3b-1, 3b-2 ([#2742](https://github.com/clintongormley/waitron/pull/2742)),
  3b-3 ([#2761](https://github.com/clintongormley/waitron/pull/2761)), 3b-4 ([#2779](https://github.com/clintongormley/waitron/pull/2779))
  3b-5a ([#2898](https://github.com/clintongormley/waitron/pull/2898); the pair link, and a spare joins with no Cloud relay)
  and 3b-5b (a spare runs its store, which admits only its main box; nothing streams to it yet) landed, 3b-G and 3b-6a onwards are still to build. 3b-4 retired `WAITRON_MIRROR_ALLOW_EXPOSED` (a spare now listens on the
  venue's network), one step **Hand over the venue** needs on real boxes. It is not live yet: a spare
  still never leaves its joining start (`finish-adoption.ts`'s `PendingAdoption`), and handover also
  needs 3b-G and 3b-6a. A second box in setup mode can be trusted by mistake in three ways, to settle before go-live. [Detail](backlog/replication-cloud.md#a947-go-live-on-two-local-boxes)

- **A1273: the shared key ring has no rotation path to the spare.** A spare gets the main box's
  ring only when it joins. Since 3b-5b, `waitron-credentials rotate` refuses while a pair link
  exists (decision D7); the two related risks in the detail stay open.
  [Detail](backlog/replication-cloud.md#a1273-the-shared-key-ring-has-no-rotation-path-to-the-spare)

- **A1274: a lost node.db beside an intact venue.db reads as a sole primary.**
  [Detail](backlog/replication-cloud.md#a1274-a-lost-nodedb-beside-an-intact-venuedb-reads-as-a-sole-primary)

- **A1296: code-quality follow-ups from A947 slice 3a's finish review.** Parallel venue and node
  code paths, a second HTTPS client, a second durable-write helper.
  [Detail](backlog/replication-cloud.md#a1296-code-quality-follow-ups-from-a947-slice-3as-finish-review)

- **A1282: browser trust after a connection repair replaces the certificate authority.** The browser
  check refused Servers, alerts and disk-stop reads with `ERR_CERT_AUTHORITY_INVALID`.
  [Detail](backlog/replication-cloud.md#a1282-browser-trust-after-a-connection-repair-replaces-the-certificate-authority)

- **A1283: spare-joining guide belongs to A947 Task 6.10**, alongside the joining feature.
  [Detail](backlog/replication-cloud.md#a1283-spare-joining-guide-owned-by-a947-task-610)

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

- **Adding a mirror while the internet is down** (owner, 2026-10-02). Wanted: a new mirror takes
  its first copy straight from the primary over the LAN. Slice 5 should name this as the way a
  mirror is added and prove it with the internet unplugged.
  [Detail](backlog/replication-cloud.md#adding-a-mirror-while-the-internet-is-down)

**Cloud integration and SQLite work.**

- **Loose ends left by the Cloud connection integration.** Customer remote setup UI and production
  deployment remain open. Continuous complete-server recovery, planned final-write handover and
  production recovery remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-cloud-connection-integration)

- **One signed request helper; strict reply readers** (bundle of 2, size M). [Detail](backlog/replication-cloud.md#bundle-one-signed-request-helper-strict-reply-readers)

- **A951-S provider trials.** Translate all returned one editable menu suggestion on the test box;
  address completion still needs its trial. Keep the approved consent and request limits.
  [Detail](backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)

- **Waitron retains:** first-contact trust bootstrap; and the cloud-standby end-to-end proof. Do not restart the cloud-standby work until the boundary contract is settled.
  [Detail](backlog/replication-cloud.md#waitron-retains)

- **Loose ends left by the SQLite failover-loop prototype gate.** Provider qualification,
  promotion generations and the Cloud recovery contract remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-sqlite-failover-loop-prototype-gate)

### CI, tests and developer tooling

- **Investigate the store's SQL bound-value test timing out in CI.** The unchanged case hit its
  five-second limit on A790's first run; retain phase timings before changing its fixture or deadline.
  [Receipt and next check](backlog/ci.md#store-bound-value-test-timeout).

- **Add a control to each check that cannot fail** (bundle of 4, size S). [Detail](backlog/ci.md#bundle-add-a-control-to-each-check-that-cannot-fail)

- **The logo retry checks' deadline and counting** (bundle of 2, size S). [Detail](backlog/ci.md#bundle-the-logo-retry-checks-deadline-and-counting)


- **Replace 14 "if it happens again" entries with one table in `docs/backlog/ci** (bundle of 14, size M). Holds A891, A999, A1230, A1305, A1027, A419. [Detail](backlog/ci.md#bundle-replace-14-if-it-happens-again-entries-with-one-table-in-docsbacklogci)

- **Finish the time limits on CI's network steps** (bundle of 6, size M). Holds A1251 and A1424's remaining capacity and hosted-fallback qualification. Scheduled health recovery covers untouched queued PR planners; PR-first placement uses only published spare capacity. Non-PR planning remains hosted. Non-planner health checks report stuck queues without moving runs; transient HTTP 5xx reads get one bounded retry. The queue watchdog retries an invalid final inventory once and accepts completed jobs retained by “re-run failed jobs”. Waiting jobs are dated from their own timestamps. The controller retains 30-record job pages; the router compares whole-run queue pressure using published server counts and refreshed hosted counts, with server ties (owner, 2026-11-09 17:19). Job inventories use 30-record pages after reproduced 100-record HTTP 502 failures. Unreadable inventories select GitHub (owner, 2026-11-10, A1470); readable stalled-server evidence also selects GitHub; cancellation and probing retain complete-inventory checks (watcher, 2026-11-09 10:34/10:47). Image smoke stays hosted until a guest is qualified; A1454 keeps six slots per host (owner, 2026-11-11); its measured fixed-split tradeoff is recorded in the CI decisions. A1461 reduces run sizes; the remaining workflows, live qualification of the routing script at its workflow commit and queue measurements remain open. [Detail](backlog/ci.md#bundle-finish-the-time-limits-on-cis-network-steps)

- **Get ready for A1308's history rewrite (A1306 and CI's concurrency groups)** (bundle of 2, 1 important, size M, waits for another entry). Holds A1306. [Detail](backlog/ci.md#bundle-get-ready-for-a1308s-history-rewrite-a1306-and-cis-concurrency-groups)

- **Real-source bundle tests repeat metadata work.**
  Measure selective shared setup and audit the remaining smaller build limits in the recovery
  PDF and provisioning CLI tests.
  [Detail](backlog/ci.md#real-source-bundle-tests-repeat-metadata-work).

- **A1251. Finish qualifying and reviewing historical PRs that skipped the Claude run-it review.**
  Exclude documentation-only changes, verified test-data/name renames and changes already reviewed.
  Review each remaining squash against its parent and check findings against current main before
  opening a repair.
  [Detail](backlog/ci.md#a1251-finish-qualifying-and-reviewing-historical-prs-that-skipped-the-claude-run-it-review).

- **One throwaway branch that interrupts an upload and re-runs a shard** (bundle of 2, size S). Holds A1251, A1213. [Detail](backlog/ci.md#bundle-one-throwaway-branch-that-interrupts-an-upload-and-re-runs-a-shard)

- **The node-identity text guard misses a retired setting after an escaped newline.**
  Inspect decoded string/template values as well as raw text, retaining legitimate negative and
  historical controls. The A696 fixtures themselves are corrected; the scanner gap remains.
  [Reproduction](backlog/ci.md#retired-settings-after-a-source-escape).

- **The nightly mutation run: downloads, shard layout and repeated jobs** (bundle of 3, size M). [Detail](backlog/ci.md#bundle-the-nightly-mutation-run-downloads-shard-layout-and-repeated-jobs)

For package distribution and the four-minute target, use the
[CI job layout](developers/ci-and-gates.md#ci-job-layout-and-scheduling).

- **A1398-2. Finish the four-minute target for dashboard and till jobs.** Selected draft autosave waits advance without sleeping, the menu test's loading wait polls sooner, static editor layout fixtures use a shorter disclosure animation, and the product-list layout tests, Menus structure matrix and printer pick-up-role matrix no longer save unused PNGs. Dashboard packing uses refreshed complete-run file durations; the remaining whole-job costs still need current-head measurement before another cut. The till’s warm-cache `cpu-features` rebuild is the next diagnostic target. [Detail](backlog/ci.md#a1398-2-slow-browser-test-files).

- **One repeated-run rig, then each named test** (bundle of 7, size M). [Detail](backlog/ci.md#bundle-one-repeated-run-rig-then-each-named-test)

- **apps/server's test speed: restart tests, measured speed-ups, fixed PINs** (bundle of 3, size L). [Detail](backlog/ci.md#bundle-appsservers-test-speed-restart-tests-measured-speed-ups-fixed-pins)

- **One failing success-branch check in the first-fiscal-setup end-to-end file ends its worker.**
  The later rows never run; the run still exits 1. Cause not found.
  [Detail](backlog/ci.md#one-failing-success-branch-check-in-the-first-fiscal-setup-end-to-end-file-ends-its-worker)

- **A backlog detail link still names the old five-handler heading.**
  [Detail](backlog/ci.md#a-backlog-detail-link-still-names-the-old-five-handler-heading).

For browser storage checks, inspect the operation's own entry and every write, comparing complete
values rather than PIN substrings inside random IDs. See the
[testing guide](developers/testing-guide.md#check-stored-secrets-as-values-and-inspect-every-write).
The cited refund test checks `setItem` calls and its own final entry; direct property assignments
under another key fall outside that check.

- **Switching the till's language mid-screen with `setLocale` left no error banner in some browser
  tests.** Not diagnosed: a test-harness effect, or a refusal a language change hides.
  [Detail](backlog/ci.md#switching-the-tills-language-mid-screen-with-setlocale-left-no-error-banner-in-some-browser-tests)

- **Whether the checkout stalls were a GitHub-side incident remains unverified (A935).**
  A1178 adds checkout-stage traces and stored-pack measurements in CI and licence jobs;
  a hosted recurrence reached `fetch_refs` with an unfinished `index-pack`, without distinguishing
  transfer from indexing.
  [Detail](backlog/ci.md#whether-the-2026-10-20-checkout-stalls-were-a-github-side-incident-was-not-checked-a935).

- **One small pull request for rule lines** (bundle of 5, size S). [Detail](backlog/ci.md#bundle-one-small-pull-request-for-rule-lines)

For database fixtures filtered by business day, make the boundary explicit and exercise the
changeover. See the [testing guide](developers/testing-guide.md#a-recent-timestamp-can-belong-to-the-previous-business-day).

- **Vitest settings: what the guide says, what A490 left, the cold-cache check** (bundle of 3, size M). Holds A902. [Detail](backlog/ci.md#bundle-vitest-settings-what-the-guide-says-what-a490-left-the-cold-cache-check)

- **A late move or second finger can overtake the gesture hold timer.**
  [Detail](backlog/ci.md#a-late-move-or-second-finger-can-overtake-the-gesture-hold-timer).

- **A1398. Test-file inventory only on a same-count mismatch** (1 conditional entry). [Detail](backlog/ci.md#bundle-a1398-pack-the-other-packages-test-shards-by-measured-time)

- **Tests copy the dashboard shell's link handler instead of calling it.**
  [Detail](backlog/ci.md#tests-copy-the-dashboard-shells-link-handler-instead-of-calling-it).

- **Retain failure screenshots for long browser test names.**
  [Detail](backlog/ci.md#retain-failure-screenshots-for-long-browser-test-names).

- **Root guard deadlines under extreme external load (left open by A751).**
  [Detail](backlog/ci.md#at-a-load-average-near-60-more-root-guard-files-fail-on-time).

- **A1307 follow-up: the file-progress reporter's tests set up a page with two near-copies of one helper.**
  Fold the new setup into the existing helper and move the two cases beside their neighbours; no
  assertion changes.
  [Detail](backlog/ci.md#a1307-follow-up-the-file-progress-reporters-tests-set-up-a-page-with-two-near-copies-of-one-helper).

- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites; the
  duplicated `boot.*.test.ts` helpers into `apps/server/src/testing/` (`freePort` has moved there,
  A80; the rest remain); a shared `useFiscalMirrorPair()` for the two-clone fiscal suites.

- **What the stream pause test's last-restore fix (A387, #1398) left open:** a local Linux run
  keeps the machine's own loopback and can still meet the stall (how often was not measured), and a
  box's restore over a real network was not measured.

- **Remaining setup/recovery and configured-port boot cases, unused-peer ports, and Cloud’s fixed-origin stop/relaunch gap need port ownership (A80/#740, A907, A1152).**
  [Detail](backlog/ci.md#what-the-landing-port-fix-a80-pr-740-left-open).


- **A throwaway script found six comments that described code that was no longer there, and it is not a guard yet**
  [Detail](backlog/ci.md#a-throwaway-script-found-six-comments-that-described-code-that-was-no-longer-there-and-it-is-not-a-guard-yet).

- **What the mutation score counts: db static mutants, the pointer test helper** (bundle of 2, size S, needs the owner). [Detail](backlog/ci.md#bundle-what-the-mutation-score-counts-db-static-mutants-the-pointer-test-helper)

- **`apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe**
  [Detail](backlog/ci.md#appsserversrcrejoin-commandtesttss-sidecar-assertions-do-not-test-the-wipe).

- **After the onboarding wizard provisions, the stack started by `wa-wt onboarding <worktree>` restarted into setup mode**
  [Detail](backlog/ci.md#the-dev-launcher-looks-for-tradingenv-only-in-the-state-folder-appsserverenv-names).

- **Cross-app links in the split Vite dev stack — OPEN, unqueued.**
  [Detail](backlog/ci.md#cross-app-links-in-the-split-vite-dev-stack).

- **Tests that close a dialog and check too soon, and pressEscape** (bundle of 2, size M). [Detail](backlog/ci.md#bundle-tests-that-close-a-dialog-and-check-too-soon-and-pressescape)

- **`scripts/dashboard-browser-purity.test.ts` checks only some of venue-service's dashboard files**
  [Detail](backlog/ci.md#the-browser-purity-guard-checks-only-some-of-venue-services-dashboard-files).

- **The server holds two separate 100-character limits for text a request sends**
  [Detail](backlog/ci.md#the-server-holds-two-separate-100-character-limits-for-text-a-request-sends).

- **drizzle-kit 0.31.11 left out `ON DELETE` when it generated an `ALTER TABLE … ADD … REFERENCES` on this engine, while its snapshot kept it.**
  [Detail](backlog/ci.md#drizzle-kit-03111-left-out-on-delete-when-it-generated-an-alter-table--add--references-on-this-engine-while-its-snapshot-kept-it).

### Dependency upgrades

_Formerly parts of B9 and Track C._ Open work:
[backlog/dependencies.md](backlog/dependencies.md).

- **A Vitest 5 retry still needs mutation qualification after the Stryker 10.1.1 update.**
  [Detail](backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it)

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  [Detail](backlog/dependencies.md#collapse-the-two-typescript-entries-back-into-one-once-typescript-eslint-supports-version-7)

- **What package manifests declare: floors, the root engines line, vite** (bundle of 3, size S). [Detail](backlog/dependencies.md#bundle-what-package-manifests-declare-floors-the-root-engines-line-vite)

- **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo.**
  [Detail](backlog/dependencies.md#the-default-browser-floor-rose-and-no-browser-floor-is-stated-anywhere-in-the-repo)

- **The till's QR pin compares the code against itself, not an authority.**
  [Detail](backlog/dependencies.md#the-tills-qr-pin-compares-the-code-against-itself-not-an-authority)

### Modules, data and code health

_Formerly B8, parts of B9, and the old Track C's correctness items; part of A9._ Detail: [backlog/architecture.md](backlog/architecture.md).

- **Query plans and indexes, measured on a year of data** (bundle of 4, 3 important, size M, waits for another entry). [Detail](backlog/architecture.md#bundle-query-plans-and-indexes-measured-on-a-year-of-data)

- **A1308. Rationalise the tables, background jobs, environment variables and files** (owner,
  2026-11-02: "over engineered and disjunct … each bit has been designed in isolation"). The
  [design](superpowers/specs/2026-11-02-rationalisation/README.md) is written, and the owner has
  reviewed every file and answered every question (2026-11-04). **Approved by the owner, 2026-11-04, and the top priority: it runs before more code is built on the old tables.**
  Lane A runs it, once A1018's current slice ends. Until A760's squash lands, slices in progress finish and no lane starts new work that adds or changes tables; work that touches no tables carries on. Slice 0's protection list is built ([how to use it](developers/testing-guide.md#the-protection-list)); so is its bench ([how to use it](developers/testing-guide.md#the-bench)). [A760's squash into eight sets](superpowers/plans/2026-11-04-a760-squash-into-eight-sets.md) has landed; the shared-table work is under way. 246 tables become 145, or 144 once A1323 removes
  `recovery_packs`; 111 environment variables become 51.
  [Detail](backlog/architecture.md#a1308-rationalise-the-tables-background-jobs-environment-variables-and-files)
  What it retires, listed until each slice lands: [What A1308 retires](backlog/architecture.md#what-a1308-retires).

- **Small checks and indexes that are cheap only inside A1308's fresh tables** (bundle of 17, 8 important, size M, waits for the A1308 table hold to lift). Holds A1368, A1351, A1366. [Detail](backlog/architecture.md#bundle-small-checks-and-indexes-that-are-cheap-only-inside-a1308s-fresh-tables)

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

- **A1301. Remove the "location" concept: the venue holds everything a location held** (owner,
  2026-11-01, high priority; nothing new is built on locations meanwhile). Still open: 5f–5h
  of A1308's slice 5; every other slice has landed. S18 has a plan
  ([S18 plan](superpowers/plans/2026-11-04-a1301-s18-contract-cleanup.md)); its S18e builds the
  approved [venue-id design](superpowers/specs/2026-11-04-a1301-venue-id-design.md) and is held by
  A1308, since it adds a table.
  [Design](superpowers/specs/2026-11-01-a1301-remove-location-design.md),
  [plan](superpowers/plans/2026-11-01-a1301-remove-location.md).
  [Detail](backlog/architecture.md#a1301-remove-the-location-concept-the-venue-holds-everything-a-location-held)

- **The setup app's configuration preview types four address fields as always text.**
  `ConfigurationPreview.venue` in `apps/setup/src/api/client.ts` is `VenueDraft`'s shape, which
  declares `addressLine1`, `postalCode`, `city` and `province` as `string`; the server's
  `PreparedVenue` (`packages/provisioning/src/configuration-transfer.ts`) sends each as
  `string | null`. Type the preview as the server sends it and check what the preview screen shows
  for an empty one.

- **The venue's menu routes are named unlike their neighbours.** S5 moved them to
  `/management-api/venue/…`, as the A1301 plan chose, while the other venue routes are one
  hyphenated segment (`/management-api/venue-details`, `/venue-defaults`). Pick one shape before
  go-live.

- **Remove code nothing reaches (replaced or dead, never merely unused)** (bundle of 21, size M). [Detail](backlog/architecture.md#bundle-remove-code-nothing-reaches-replaced-or-dead-never-merely-unused)

- **Go-live day steps.**
  [Detail](backlog/architecture.md#go-live-day-steps).

- **Read every insert that grows with an order** (bundle of 3, 2 important, size M). Holds A1299. [Detail](backlog/architecture.md#bundle-read-every-insert-that-grows-with-an-order)

- **Full-invoice recipient: comma refusal and country code names** (bundle of 2, 1 important, size S). [Detail](backlog/architecture.md#bundle-full-invoice-recipient-comma-refusal-and-country-code-names)

- **Recovery wording into `i18n`, with table names to match** (bundle of 2, size S). [Detail](backlog/architecture.md#bundle-recovery-wording-into-i18n-with-table-names-to-match)

- **Spanish text in a server test venue, for A913's English-only audit.**
  `apps/server/src/testing/bill-venue.ts` names its products "Paella" and "Caña", and in the look
  test's venue the Spanish refund dialog shows the reason "Mistake" in English. Found by A798-B
  slice 8 (#2012).

- **Regional demo screen qualification.** Inspect the seeded till, kitchen and dashboard in both
  screen languages, themes and phone/desktop widths when the stack is available. The regional cuts'
  local Mailpit start refused the absent Docker socket. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A974. Finish the remaining English names in general code.**
  Remaining work includes the server split suites' comments, private bill/party helper
  bindings and file names.
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

- **Tighten the checks the A974 review probed** (bundle of 3, size S). [Detail](backlog/architecture.md#bundle-tighten-the-checks-the-a974-review-probed)

- **A976. Finish the server's English test-venue defaults.**
  The single- and multi-bill editor suites use Anna and Lewis as local staff samples.
  The `floor-today-*` route suites use Anna as their staff sample.
  Local course-retention, service-step, status, kitchen-note, allergy, today-join, course and party route fixtures use Anna for staff.
  The provision, setup-api.throwaway, promote-api.handover, break-glass-command and
  backup-api.settings-evidence suites use Administrator for their local administrator display-name samples.
  The backup-api.route and mirror-bundle-api suites use English staff display-name samples.
  The cancel-invoiced-order and unpaid-departure suites use Sophia for their local supervisor samples.
  The device-equipment and device-levers suites use English staff display-name samples.
  Local floor-signal, pairing and till clock-state staff samples use Lucy, Anna and Lewis.
  The attendance-discovery, attendance-obligations, boot.mirror, boot.clock-watch and standalone tab-person suites use Anna and Martha for their main staff sample.
  Local till table, zone-layout, zone-required, split-bill, floor-catch-up and today-names suites use Anna for their staff-role person.
  The device-join suite uses Server and Manager for its local staff-role display samples.
  The main till API and profile-zone suites use Anna, Martha and Beatrice where present; local
  delivery, published-menu sale and unroutable-dish staff samples use Cashier.
  Local box-host, box-health, disk-stop and clock set/confirm route fixtures use Martha, Anna
  and Simon for their manager, administrator and supervisor samples; the clock suites' administrators remain Mario and Berta.
  Local alert, box-host call, attendance-fact, bill-editor transition, transfer-close and orders
  route fixtures use English staff display-name samples.
  Spanish staff display-name samples remain, including in the shared `testing/` helpers.
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

- **Correct every sentence known to be false, then finish comment pruning** (bundle of 27, size M). [Detail](backlog/architecture.md#bundle-correct-every-sentence-known-to-be-false-then-finish-comment-pruning)

- **A646 — a Modules page where the administrator switches optional modules on and sets them up (OPEN; A483 remains).**
  [Design](superpowers/specs/2026-10-16-a646-modules-page-design.md); [plan](superpowers/plans/2026-11-11-a646-modules-and-card-providers.md).
  Administrators can turn card providers on or off while keeping credentials for earlier payments.
  The other five optional modules are listed but cannot be switched until A483. Exports with optional modules off load with those modules on and empty.
  Google sign-in is no longer part of it (owner, 2026-11-11): see A1507 under Later and parked.
  [Detail](backlog/architecture.md#a646--a-modules-page-where-the-administrator-switches-optional-modules-on-and-sets-them-up)

- **Printer, reader and device delete wording and tidying** (bundle of 2, size M, needs the owner). [Detail](backlog/architecture.md#bundle-printer-reader-and-device-delete-wording-and-tidying)

- **Unchecked: pairing a new reader can undo the SumUp registration it just made** when SumUp is
  disconnected during the add (the post-provider compensation branch of the add-reader route,
  `apps/server/src/payments-api.ts`), and an adoption running at the same time is not told.
  Believed to predate A435 step 3 (#1520); not reproduced.

- **`modules.json` has no flow-down channel** from a primary to its standby (matters under
  _Afterwards_, designed now that bookings is genuinely toggleable), and a toggleable module that is
  load-bearing (identity, payments) fails boot loudly if disabled until the wiring inversion.
  [Detail](backlog/architecture.md#modulesjson-has-no-flow-down-channel-from-a-primary-to-its-standby)

- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).

- **The two `stripSql` scanners and their copied patterns** (bundle of 2, size S). [Detail](backlog/architecture.md#bundle-the-two-stripsql-scanners-and-their-copied-patterns)

- **Loose ends left by A394-3 (#1447).**
  [Detail](backlog/architecture.md#loose-ends-left-by-a394-3-1447).

- **A394-5, A394-10, A394-16 and A394-20 to A394-22 — refusal statuses by one rule** —
  OPEN, low priority, not queued — owner 2026-10-08: take them from here when a lane has room. (A394-1 to A394-4 landed as #1441, #1444, #1447 and #1455.) The follow-ups and the rows:
  `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.
  [Detail](backlog/architecture.md#a394-5-a394-10-a394-16-and-a394-20-to-a394-22--refusal-statuses-by-one-rule)

- **Every read route now takes the venue's exclusive write lock and issues a DELETE** — OPEN.
  **Next action:** decide whether a read-only body should take the lock at all.
  [Detail](backlog/architecture.md#every-read-route-now-takes-the-venues-exclusive-write-lock-and-issues-a-delete)

- **One identifier validator, one error walker** (bundle of 2, size S). [Detail](backlog/architecture.md#bundle-one-identifier-validator-one-error-walker)

- **Raw engine imports and hand-spelled file names** (bundle of 2, size S, waits for another entry). [Detail](backlog/architecture.md#bundle-raw-engine-imports-and-hand-spelled-file-names)

- **Loose ends left by A483 (#1544).** OPEN. A start migrates, re-protects and checks only the
  modules switched on.
  [Detail](backlog/architecture.md#loose-ends-left-by-a483-1544).

- **Nothing stops two queries being started at once on one transaction.** The rule and its receipt
  are in `docs/developers/conventions-data.md` under "Multi-table writes share ONE transaction"; no
  test or lint rule enforces it. A guard could fail a test whenever a query is issued on a
  transaction while another is still running.

- **A module this server runs with no transfer declaration, or no recorded version, is refused as
  `setup.request_invalid` field `module:<name>`** (`packages/provisioning/src/configuration-transfer.ts`),
  which setup words, when the export is uploaded, as "The configuration export could not be opened.
  Check the file and passphrase." That blames the file for a fault in this server's own build. An
  export from a box running other modules now has its own code, `setup.configuration_parts_differ`
  (A1384). Left open by A261-2e's review (#1277); whether a shipped build can reach it is unverified.

- **SP-4 — the module UI surface on the TILL** (card-registry inversion, self-sourcing cards); the
  dashboard half is done. Migrate the remaining core dashboard screens onto the module UI seat and off
  the coarse `requiresManager` gate. A core nav item can now also name a `requiresPermission`
  (`apps/dashboard/src/dashboard-app.ts`); Servers (`mirror.create`) is the first to use it.

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
- **Whoever lands second rebases — only on a code-file overlap or a GitHub conflict.** A PR that is
  merely `BEHIND` lands as is with `gh pr merge --squash --admin` (CLAUDE.md §6). Module-owned
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
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. `wa-wt ls` shows another stack's till, dashboard and server ports. The till enrols itself
on first load in dev mode. Till PIN **5555**; dashboard **owner@demo.waitron.local / dashPass123**.
`dev:setup` seeds three menus (~44 products with images), a floor plan (5 zones / ~16 tables),
staff on PIN 5555, and ~28 days of back-dated preproduction sales — seeded in English by default,
Spanish via `WAITRON_SEED_LOCALE=es-ES`, except the customer-facing languages, which are the Madrid
venue's: Spanish by default with English beside it. `wa-wt onboarding <worktree-name>` for a fresh
shipping-style wizard; `wa-wt reset demo|onboarding [worktree-name]` wipes and rebuilds.

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
  trial demo.
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
| 1   | Design system                | `@waitron/ui` token layer + primitives (`--wt-*`); brand assets (#284); the till web-app manifest and its icons; the dashboard shell restyle — collapsible nav, account menu, profile modal (#333)                                                                                                                                                                                                                                | sorting `wt-combobox` options (_Users, sign-in and the dashboard shell_)                                                                                                      |
| 2   | Sales spine                  | Immutable hash-chained sales, per-node series, catalogue, the one-taxpayer model                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                             |
| 3   | Fiscal layer                 | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`)                                                                                                                                                                                                                                                                                   | F3 asesor/XSD confirmations; the owner's real-certificate checks after A795 lands (A888); cert distribution to a promoted node      |
| 4   | Payment layer                | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration and adoption (#323, #329)                                                                                                                                                                                                                                                    | webhook `recordSale` hand-off; reconcile remediation UI; Tap-to-Pay on the handheld (_Payments and card readers_)                                                             |
| 5   | Identity                     | persons/sessions, PIN (+ wrong-PIN back-off: per device at sign-in and for override PINs), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); a one-time passkey offer on first password sign-in (#347); identity state replicates to a standby                                                        | admin-editable roles; security-change emails; mid-shift-suspension enforce; discount gate; till-refund enforce                                                                |
| 6   | Venue                        | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297)                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                             |
| 7   | Counter POS                  | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, receipt configuration, receipt/drawer printing, cash-drawer authorization — operable end to end                                                                                                                                                                                                                                                        | —                                                                                                                                                                             |
| 8   | Reporting                    | daily close, frozen _cierre Z_, VAT summary, modelo 303 output+input VAT + DR303 file and its download route and its dashboard screen, purchase-invoice UI; dashboard sales screen (with a category sales report, at time of sale or current, printable) + business-overview home                                                                                                                                                 | fiscal filing remainder parked (_Reporting — the fiscal remainder_)                                                                                                           |
| 9   | Deployment                   | the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); boot diagnosability (#310); CA-trust onboarding + per-OS certificate walkthrough (#330); till reroute S1–S6; promotion endpoint (#272)                                                                                                                                                                                     | USB installer (B3); cloud standby live link + the Waitron Cloud boundary                                                                                                      |
| 10  | Tabs / table service         | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324)                                                                                                                                                                                                                                                                                                             | core COMPLETE; owner-added extensions parked                                                                                                                                  |
| 11  | Floor plan                   | FP-1 live floor + FP-2 spatial canvas/editor                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                             |
| 12  | KDS / devices                | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269)                                                                                                                                                                                                                                                                        | routing audit view; a device-scoped collect route                                                                                                       |
| 13  | Tips                         | tip choices on bill payments (card, cash) and on the whole-order screen for a connected reader, off unless `WAITRON_TILL_TIPS` is set; kept off the invoice; sharing and payroll: A793's first design not approved, needs a brainstorm                                                                                                                                                                                                                       | sharing, the Tips page and the pay-period statement (A793); payroll export (integrate-not-build)                                                                              |
| 14  | Bookings                     | Bookings-1, now the `@waitron/bookings` module (#270, #273)                                                                                                                                                                                                                                                                                                                                                                       | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits                                                                                            |
| 15  | Online ordering              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 | not started (later phase)                                                                                                                                                     |
| 16  | Workforce                    | _registro de jornada_ library (chain per node since #268), till clocking and breaks, D2 scheduling, roster authoring + approvals, staff request path + portal; own/manager Hours and PDF/CSV working-time exports | inspector remote access; advisor export checks; wage-computation engine (convenio-gated); D3 payroll export (integrate-not-build)                                         |
| 17 | Accounting export | Generic two-sheet XLSX period download from Sales & takings: issued invoices and recorded purchases | Real accountant import trial before claiming support for a named accounting program |
| 18  | Menu/allergens       | EU-14 allergens, declared directly on the product since #345, product images, venue↔menu membership, extras and options lists end to end (the legacy option groups are gone — Task 13 dropped their tables), per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297) | menu schedule (publishing landed, #677); customer-facing menu surface parked       |
| 19  | Opening hours & channel sync | —                                                                                                                                                                                                                                                                                                                                                                                                                                 | not started (Google Business Profile / Maps)                                                                                                                                  |
| 20  | Procurement & inventory      | received purchase invoices (`@waitron/purchasing`, feeds modelo 303)                                                                                                                                                                                                                                                                                                                                                              | suppliers/POs/goods-in/stock/3-way reconcile/reorder (parked); AI forecast deferred                                                                                           |

**Cross-cutting infra:** replication (none: no node replicates to another until slices 3–5 rebuild failover) ·
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
| Q31 (correct an issued ticket by differences or by substitution)                                      | `recordCorrection` files by differences (`"I"`); no route calls it _(2026-10-02, C126: the whole-order cancel route now calls it for a whole-invoice credit)_                                              | **Answered**: the business's choice (art. 15.5; AEAT FAQ) |
| Q32 (how a cancelled order's already-issued simplified invoice is undone)                             | the whole-order cancel credits the invoice in full with an R5 corrective invoice, not an annulment (C126)                                                                                                  | S7 |
| Q42 (a bill paid later by transfer: invoice now, or a proforma and the invoice on payment; F1 and F2) | no till action issues an invoice for the customer to pay later (only invoice-first placing and an unpaid departure issue one before payment); a payment by transfer is refused (`sale.unsupported_tender`) | Option 2 not lawful for a consumer; deposits S8, unpaid debts S6 |

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
needs; it makes its own temporary venue directory. A worker limit is still a per-package call, and
the reason that is left is the `@vitest/coverage-v8` cross-fork branch-merge artifact, which needs
`maxWorkers: 1` where a small package runs under `pnpm -r` oversubscription — the worked reasoning
is in #558's first commit message (2026-09-24). `packages/db` keeps `maxWorkers: 4`, which CI's
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
| [Language fallback](superpowers/specs/2026-08-30-localization-fallback-negotiation-design.md)                                                                                                     | partly built                                                                                                                                                               | _Menus and the catalogue_ (_Language resolution follow-ons_)              |
| [Native app capabilities](superpowers/specs/2026-08-30-native-app-capabilities.md)                                                                                                                | reference; nothing committed                                                                                                                                               | the go-native decision                                                    |
| [Logging and diagnostics](superpowers/specs/2026-08-31-logging-diagnostics-foundation-design.md)                                                                                                  | Slice 1 built (#192)                                                                                                                                                       | _Alerts, logging and diagnostics_                                         |
| [Fiscal certificate distribution](superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) and its plan                                                                                   | reverted (#281); describes a removed mechanism                                                                                                                             | _Replication, failover and the cloud_                                     |
| [Handheld app store and kiosk](superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md)                                                                                             | reference; its own-phones decision reversed 2026-09-18                                                                                                                     | —                                                                         |
| [Box maintenance and remote support](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)                                                                                          | discussion record; not started                                                                                                                                             | _The box: backups, upgrades and recovery_                                 |
| [Failover prototype](superpowers/specs/2026-09-16-sqlite-failover-prototype-design.md) and its plan                                                                                               | done (#425); `bench/sqlite-failover` points at it                                                                                                                          | _Replication, failover and the cloud_                                     |
| [SQLite + Litestream topologies](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md)                                                                                               | slices 1 and 2 built; 3 to 5 not started                                                                                                                                   | _Replication, failover and the cloud_                                     |
| [Handheld and till hardware decisions](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)                                                                                      | decisions; the reader dropdown exists                                                                                                                                      | _Payments and card readers_ (Slice 2)                                     |
| [Menus, sections and home layouts](superpowers/specs/2026-09-20-menus-categories-and-home-layouts-design.md) and its plan                                                                         | built (#729 last); owner decisions still open; its home layouts superseded by W93's [Device Home Page design](superpowers/specs/2026-10-05-w93-device-home-page-design.md) | _Menus and the catalogue_ (_Sales classification and the menus plan — what they left open_) |
| [Service, ordering and billing](superpowers/specs/2026-09-20-service-ordering-and-billing-design.md) and its plan                                                                                 | all 18 tasks landed (Task 17 last, #991); what they left open is under The till, devices and table service                                                                 | The till, devices and table service                                       |
| [Sales classification](superpowers/specs/2026-09-25-sales-classification-and-category-reports-design.md) and its plan                                                                             | built (#738 last); a code comment points at it                                                                                                                             | _Menus and the catalogue_ (_Sales classification and the menus plan — what they left open_) |
| [Bill payments](superpowers/specs/2026-09-26-bill-payments-design.md)                                                                                                                             | server built (#721); the till side built by lane B item B15 (#956)                                                                                                         | The till, devices and table service                                       |
| [Print agent setup lockdown](superpowers/specs/2026-09-27-print-agent-setup-lockdown-design.md) and its plan                                                                                      | all three branches built (#732, P2b in #877, and P2c in #884); a real pairing at the box to go                                                                             | _Printers, the print agent and receipts_                                  |

**Dev stack from a worktree.** `wa-wt demo|onboarding <worktree-name>` starts up to eight isolated
stacks. `wa-wt ls` shows their ports; `wa-wt reset demo|onboarding <worktree-name>` rebuilds only
the named venue. The rule is in CLAUDE.md §6; detail in
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
