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
- **Never autonomously land anything touching the unrepairable fiscal core** — hash-chained records,
  never-reused invoice numbers. Fiscal-adjacent work in any area takes owner sign-off at land.
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
  Replication, backup, restore and a cloud move are then one mechanism. The URL is
  content-addressed and served `immutable`, so each device fetches each image once until its bytes
  change.
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

Ranked 2026-09-27, after the specs still in `docs/superpowers/specs/` were checked against the code
(each spec's state is under _Reference → Specs still in the tree_). Each item is its own brainstorm →
spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.

1. **Finish table service and paying a bill in parts** (_The till, devices and table service_,
   lane B). All eighteen of the service plan's tasks are done, the last being Task 17, a table
   that leaves without paying (#991).
   What Task 16 (counter handover, #981) and Task 17 left open is in their Task 16 and Task 17
   entries under that area.
   **Send asesor Q27–Q29 now:** the owner decided Q28 without the asesor on 2026-10-01 and Task 17
   is built on it, so Q28 is asked to confirm; how Task 11's discount appears on the invoice is
   Q29, and printing the invoice before payment is Q27.

2. **Build good screens for each kind of device, and retire canvases** (A182, under _The till,
   devices and table service_, owner 2026-10-01). The till, handheld, kitchen screen and pass are
   still built from stored canvases of tabs and cards, against the owner's 2026-09-20 decision for
   well-designed built-in screens. Owner, 2026-10-08: delete canvases now, keeping today's default
   layouts as fixed built-in screens, and redesign the screens afterwards; no new feature is built
   as a canvas card.

3. **Staff cannot clock in or out** (A10, under _Working time and staff_). The working-time record
   is a legal duty from the first day the deli employs anyone, and only its library is built:
   nothing in `apps/` calls `clockIn` or `clockOut`.

4. **What a standalone box still lacks before a real venue runs it** (under _The box: backups,
   upgrades and recovery_, except the certificate, under _Fiscal records, invoices and the asesor_):
   - an off-box home for the backup archive — the bucket stream of `venue.db` is built, but
     archives can only be saved on the box itself (`LocalFsBackend`);
   - installing or renewing the AEAT certificate after setup — today only the setup wizard can
     set it, and nothing watches when it expires;
   - upgrade testing with rows the product itself writes and a real older database —
     owner-marked blocking before go-live;
   - the bootable USB installer (B3), the last piece of "install without a terminal";
   - the degraded-but-trading recovery spec.

5. **The till does not load its menu until a manual refresh** (_The till, devices and table
   service_). Seen on the blank-box-to-selling run; the box and sale path worked.

6. **The displays and the printers walked at the real box** (_The till, devices and table
   service_; _Printers, the print agent and receipts_) — till, handheld and KDS through
   [ui-review.md](ui-review.md), and the first physical print since #327: slips, duplicates, the
   drawer pulse, the feed-before-cut. Since C107 (#974) every printout
   is drawn as pictures, and none of them (the ruler page, the sample receipt, a receipt, a kitchen
   ticket) has been photographed or recorded as printed. A real sale's slip, the duplicates, the
   cash-settlement drawer job and the feed-before-cut are still unwalked.

7. **Smaller, independent pieces**, in no fixed order: refusing requests from a device that is not
   enrolled (_The till, devices and table service_); Logging Slice 2, the one-touch bug report
   (_Alerts, logging and diagnostics_); the first real Bluetooth pairing at the box through the
   dashboard (_Printers, the print agent and receipts_; the print agent's side, P2b, and the
   dashboard's, P2c, are built); paying at the table from a handheld (Slice 2, under _Payments and
   card readers_).

Then the on-prem mirror and failover — slices 3 to 5 of the storage design — then the cloud primary,
under _Replication, failover and the cloud_. Everything else ranks beneath these.

---

## Open work, by area

Every open entry is here, under its area. The areas replaced the old Tracks A, B and C,
_Afterwards_ and _Detail_ (A430,
[plan](superpowers/plans/2026-10-08-a430-backlog-open-work-only.md)); each area's italic
"Formerly …" line names the old sections it absorbed, so an old pointer such as "A4" still finds
its place. A long entry keeps its first lines here and its whole text in the area's detail file
under `docs/backlog/`.

### Fiscal records, invoices and the asesor

_Formerly A1 (with A1a–A1e, A231, A231d, A275 and W41s), and the old Track C's fiscal items; part of A9._ Detail: [backlog/fiscal.md](backlog/fiscal.md).

- **A resent cancellation AEAT already holds now counts as accepted when AEAT's stored fingerprint
  matches the cancellation's** (`drain.ts`'s `handleDuplicate`; a mismatch still halts with
  `fiscal.duplicado_anulado`). Shown against the library's fake only; what real AEAT answers to a
  resent cancellation is not established. The owner may want to confirm this choice. Left open by A230 (`@waitron/verifactu` 0.2.1, #1099).

- **`HUELLA_MISMATCH` is filed and flagged, not refused.** It is not expected to occur, since
  Waitron's own builder computes the fingerprint; nothing tests that it cannot. Refusing it may be
  preferred since a wrong fingerprint is permanent. Left open by A230 (`@waitron/verifactu` 0.2.1, #1099).

- **No sale over €3,010 can be made at all** — left open by A230 (`@waitron/verifactu` 0.2.1, #1099). Waitron issues only simplified invoices and no screen accepts a customer's tax ID, so a full invoice is not offered. [Detail](backlog/fiscal.md#no-sale-over-3010-can-be-made-at-all)

- **A voided sale whose lookup AEAT answers under the sale's own reference** is not handled; not
  shown to happen either way. Left open by A230 (`@waitron/verifactu` 0.2.1, #1099).

- **An unusable `TiempoEsperaEnvio` is not recorded** anywhere (the raw value is dropped). Left open by A230 (`@waitron/verifactu` 0.2.1, #1099).

- **Owner decision 2026-09-24: a void counts on the day it is made, not the day of the sale** —
  found by #601 while pruning comments. The quarterly _modelo 303_ keeps its old behaviour, pinned
  by a test in `vat-return.test.ts`, until the asesor answers `docs/compliance/asesor-questions.md`
  Q25 (which VAT period a later annulment lands in). No till screen or server route calls
  `recordVoid` yet.
  [Detail](backlog/fiscal.md#owner-decision-2026-09-24-a-void-counts-on-the-day-it-is-made-not-the-day-of-the-sale)

- **Test titles still carry claims the comments no longer make** — found by #598 while pruning
  comments (`packages/core`). No test reaches `settleSale`'s catch that turns a `sale_settlements`
  unique-key refusal into `sale.already_settled` (`packages/core/src/settle-sale.ts`); #598 measured
  the earlier check stopping both concurrent-settlement tests first.
  [Detail](backlog/fiscal.md#test-titles-still-carry-claims-the-comments-no-longer-make-598)

- **Two SQL comments inside a `sql` string in `packages/fiscal/src/testing/fake-backend.ts` are
  code, not comments** — found by #592 while pruning comments. `FiscalBackend.pendingCount` has no
  caller outside the backends and their tests, yet `packages/db/src/schema/sales.ts:29` says it is
  how the count is read.
  [Detail](backlog/fiscal.md#two-sql-comments-inside-a-sql-string-in-packagesfiscalsrctestingfake-backendts-are-code-not-comments)

- **`packages/fiscal-verifactu` code** — found by #562 while pruning comments. **Open:** a failed
  lookup, when the save reaches its line, still backs the whole batch off, discarding every line's
  outcome and the reply's receipt code (the CSV, one per submission), which AEAT does not send
  again. [Detail](backlog/fiscal.md#packagesfiscal-verifactu-code)

- **Two 2026-07-26 specs still call the FNMT seal certificate's export unverified**, which
  `docs/compliance/getting-to-production.md` §4 closed that day (found by #577).

- **The three alta builders repeat their record assembly** — `recordSale`/`recordCorrection`/
  `recordSubstitution` in `packages/fiscal-verifactu/src/backend.ts`; the VAT lines already share
  `toDetalleDesglose`. Safe seam: a helper taking the assembled `Omit<AltaInput,"Encadenamiento">`;
  needs a huella-invariance re-run across all three.
  Fiscal: each behind its own review, owner sign-off at land.

- `mirror-bundle.ts`'s `r.series ?? []` branch is un-exercised; export `ID_SISTEMA_MAX_LENGTH`
  when either package is next touched; `insertNodeSeriesTx`'s held-code check is SELECT-then-INSERT.
  Fiscal: each behind its own review, owner sign-off at land.

- **Product decision to take before production:** The €0 comped sale settles at the settlement
  instant, not backdated to `issued_at` — is a comp ever finalised long after the invoice printed?

- **Product decision to take before production:** The duplicate purchase-invoice key
  `(supplier_tax_id, supplier_invoice_number)` is unique forever — per-year versus forever is the
  asesor's.

- **Reporting — the fiscal remainder (parked)** — left open by the modelo 303 work (#76, #91, #98,
  #1106). Two pre-filing caveats a human must clear before the first LIVE 303 filing: validate the
  DR303 file once against the real AEAT "por fichero" uploader (we omit página 2, régimen
  simplificado); and an asesor must confirm the **prorrata** treatment (`computeInputVat` scales only
  the cuota by `deductible_proportion`). [Detail](backlog/fiscal.md#reporting--the-fiscal-remainder-parked)

- **Modelo 303's deferred build slices (parked):** rectificativas de facturas recibidas (casilla
  40/41, needs a `corrects_purchase_invoice_id` self-FK); bienes-de-inversión regularización (43);
  the prorrata rule (44, asesor-driven); intra-community and import boxes (32–39); a libro-registro /
  Pre303 export. [Detail](backlog/fiscal.md#reporting--the-fiscal-remainder-parked)

- **A1a. A foreign business customer needs an identifier-type decision** — `recordSale` now names
  a Spanish recipient on a full invoice. A non-Spanish one is refused by name
  (`fiscal.foreign_recipient_unsupported`), deliberately: AEAT's `IDOtro` needs an `IDType` —
  NIF-IVA, passport, residence certificate and so on, enumerated in `@waitron/verifactu`'s AEAT XSD
  (`SuministroInformacion.xsd`) — and choosing wrongly files a record into an append-only table that
  can never be unfiled. Whoever wires up business-customer sales makes that call. [Detail](backlog/fiscal.md#a1a-a-foreign-business-customer-needs-an-identifier-type-decision)

- **The audited AEAT package's own shared record fixture (`@waitron/verifactu`'s `ALTA_INPUT`) is
  still a full invoice naming no recipient** — the shape A1 corrected everywhere else. Not free to
  fix: it reproduces AEAT's vector-1 hash and the exact-XML expectations in `xml/serialize.test.ts`
  would all move. Raised by the A1 review wave (A1d).

- **`packages/fiscal-verifactu` restates rules the validator owns** — Exporting the patterns from
  the library instead was DEFERRED on purpose (owner, 2026-09-12) — it widens an audited fiscal
  library's public surface and the drift guard already closes the risk. Revisit when something else
  needs those patterns. Raised by the A1 review wave (A1d).
  [Detail](backlog/fiscal.md#packagesfiscal-verifactu-restates-rules-the-validator-owns)

- **A1e. Simplified and full invoices use separate series** — BUILT, PUBLIC F1 DISABLED
  (2026-10-06); and **A231. Full invoices at the till** — GATED IMPLEMENTATION LANDED (2026-10-06).
  The two entries name the same open work, public F1. Public F1 issuance remains disabled; no route
  calls `recordSubstitution`. Asesor Q5(d) remains open for F3 and R5. **Next action:** verify
  physical 58/80 mm paper and QR output, complete A231q's remaining original-delivery choices, obtain
  the asesor's manual-remedy approval and settle applicable B2B delivery before enabling public F1.
  The operation day is the owner's provisional service-start rule, awaiting asesor confirmation.
  [A1e detail](backlog/fiscal.md#a1e-simplified-and-full-invoices-use-separate-series--built-public-f1-disabled-2026-10-06), [A231 detail](backlog/fiscal.md#a231-full-invoices-at-the-till--gated-implementation-landed-2026-10-06)

- **A231d. Full invoices by email as a PDF, and on an office printer** — PART 1 LANDED (#1399); PART
  2 OPEN. A231q still owes the setup/dashboard and delivery screens, provisioning/restore checks,
  office-printer discovery/registration/location selection and IPP transport, send-again/download
  and withdrawal actions, built-image renderer execution, box measurements and physical output.
  Physical checks require owner presence or arrangement; adviser confirmation and public F1
  acceptance gates remain separate. **Owner decisions in place of the asesor's answers (2026-10-07,
  under the plan's Task 0.1), so A231p may be built.** Public F1 stays disabled until A231's own
  enablement gates are met; the asesor is asked to confirm these as
  [Q44](compliance/asesor-questions.md#q44-sending-a-full-invoice-as-a-pdf-by-email-or-on-a4--the-owners-interim-answers-added-2026-10-07).
  [Detail](backlog/fiscal.md#a231d-full-invoices-by-email-as-a-pdf-and-on-an-office-printer--part-1-landed-1399-part-2-open)

- **When the business e-invoicing regime starts** — recorded in A231d. So from about October 2027,
  or October 2028 for smaller businesses, an invoice to a Spanish business must be a structured
  message, and a PDF alone is not enough (the design's register, RD 238/2026 art. 7.1). The exact
  end day of each period, and whether a restaurant's F1s to businesses fall inside the regime, are
  asked as
  [Q45](compliance/asesor-questions.md#q45-when-does-structured-business-invoicing-reach-a-restaurants-full-invoices-added-2026-10-07).
  [Detail](backlog/fiscal.md#a231d-full-invoices-by-email-as-a-pdf-and-on-an-office-printer--part-1-landed-1399-part-2-open)

- **A275. Invoice a bill paid later by transfer (full or simplified invoice)** — WAITS ON ASESOR Q42
  (2026-10-06).
  [Q42](compliance/asesor-questions.md#q42-a-bill-paid-later-by-bank-transfer--invoice-now-or-a-proforma-and-the-invoice-on-payment-added-2026-10-06)
  asks the asesor whether both are lawful and which is recommended, for full invoices (F1, A231) and
  simplified invoices (F2) alike, with non-payment and deposits. **No design or build until the
  asesor answers and the owner decides.** [Detail](backlog/fiscal.md#a275-invoice-a-bill-paid-later-by-transfer-full-or-simplified-invoice--waits-on-asesor-q42-2026-10-06)

- **W41s. Fiscal prevention and offline recovery** — DESIGN AND REVISED PLAN APPROVED (2026-10-04).
  **Update, 2026-10-08: paused and not queued.** The owner paused the remaining W41s tasks on
  2026-10-06 ("pause the other w41 tasks for now, continue with the non-w41 tasks") and on
  2026-10-08 took them off the campaign queues; take them from here when they are un-paused. Q5(f)
  and Q33–Q40 in the adviser document are revised, and Q41 covers issued invoices missing from the
  backup. Task 3 can use the published receipts; D2 retains its remaining plan gates, and D5 still
  needs old-chain evidence and its adviser answer. [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

- **Still open after W41s-3 (#1289)** — no probe has yet shown what AEAT does with a record sent
  after a 3000 conflict or after a held cancellation; the owner chose (2026-10-06) to keep holding
  there, and the live probe of those two cases is queued as W41s-1b. A refusal that would refuse
  every later record (one about the taxpayer's identity, say) opens one case per record until the
  brake below stops the chain; one reply can still open up to 1,000 cases first
  (`MAX_REGISTROS_POR_ENVIO`). [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

- **Follow-up (W41s Task 8, held-record resolution): release a brake hold (send the held records
  again).** — left open by W41s-3b (#1303), which says "Nothing releases the hold yet." Task 8 as
  planned resolves records that have a case of their own; a record the brake holds has none. While
  held, those records are not retried hourly. W41s-3d (a chain held by repeated same-code refusals
  sends its first held record once an hour) is built and reviewed on draft PR
  [#1309](https://github.com/clintongormley/waitron/pull/1309), branch
  `feat/w41s-brake-hourly-probe`, kept as it was; it needs a rebase before landing.
  [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

- **Still open after W41s-3c (#1304)** — in AEAT's preproduction environment two runs of shuffled
  envíos of up to 1,000 records each got their replies back in the order sent (verifactu #138's
  probe, recorded in [Q43](compliance/asesor-questions.md)); production is not measured, and the
  question stays with the asesor. One option for the owner, not built: after a mismatch, send each
  unknown record again in an envío of its own. And no run against real AEAT has shown that a
  cancellation's reply line names the cancelled invoice (the schema types the line's `IDFactura`
  with the plain field names, and the library's fake echoes the cancelled invoice there).
  [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

- **Re-examine the hold behind an unknown outcome once the asesor answers** — OPEN (waiting on the
  asesor; owner 2026-10-06). The owner kept the hold for now (it landed with W41s-3c, #1304) and
  asked to revisit it when the asesor answers Q37 and its siblings
  ([questions](compliance/asesor-questions.md)): drop the hold, keep it, or add the overtaking case
  to the W41s-1b probe first. [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

- **For Task 9 (the filing screen):** `listFilingCases` reads every case and event with no filter or
  paging, and `heldRecords` reads every `rechazado`/`detenido` row; neither has a production caller
  yet, so the screen should add an open-only filter or paging when it calls them. From W41s.

- **A 0.00 simplified invoice:** B17's departure, and since B28 (#1005) Pay on a bill whose total is
  zero, file one; whether AEAT accepts it was not tested. Left open by service Task 17 (#991, a
  table that leaves without paying).

- **For the owner, from B33's review: the cancel checks the permission after its payment refusals.**
  Moving it earlier changes who gets which refusal; not decided. Left open by C126 (cancelling an
  order whose invoice was issued credits it, #1030).
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **`GET /api/cancel-credit-authorizers` (B33) lists the active holders of `sale.rectify`.** Every
  role holding `sale.rectify` today also holds `sale.refund`, `sale.void` and `cash.drawer`, so its
  cases cannot tell which of those it reads. Left open by C126 (cancelling an order whose invoice
  was issued credits it, #1030).

- **C132 (landed as #1060): a credit note's line names the invoice line it reverses.** Open, for
  partial corrections only, which no product code makes yet (only tests and demo scripts do):
  whether a line a correction ADDS (a new charge, not a change to an invoice line) stays unlinked,
  and whether two adjustments may name the same invoice line. When a report starts reading the link
  it will want an index on the column, as `sales_corrects_idx` serves `sales.corrects_sale_id`. Left
  open by C126 (cancelling an order whose invoice was issued credits it, #1030).

- **A fully credited bill's original invoice can still be reprinted**, from the till and from the
  dashboard; the server allows it. Whether a reprint should say the invoice was credited is not
  decided. Left open by C126 (cancelling an order whose invoice was issued credits it, #1030).

- **An invoice that already has a correction cannot be cancelled.** No route issues a credit note
  other than this one. Left open by C126 (cancelling an order whose invoice was issued credits it,
  #1030).
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **The credit note is not printed** for the customer (asesor Q32 (b)). Left open by C126
  (cancelling an order whose invoice was issued credits it, #1030).

- **Asesor questions to send:**
  [Q27](compliance/asesor-questions.md#q27-money-taken-against-a-bill-before-its-invoice-exists-then-a-split-added-2026-09-26)
  (money before the invoice, then a split; printing the invoice first),
  [Q28](compliance/asesor-questions.md#q28-a-table-leaves-without-paying--is-the-invoice-still-owed-added-2026-09-26)
  (unpaid departure; built on the owner's decision, asked to confirm) and
  [Q29](compliance/asesor-questions.md#q29-how-a-discount-or-comp-appears-on-a-simplified-invoice-added-2026-09-26)
  (how a discount or comp appears on the invoice), and
  [Q32](compliance/asesor-questions.md#q32-cancelling-an-order-whose-ticket-was-already-issued--a-corrective-invoice-or-an-annulment-added-2026-10-02)
  (a cancelled, already-issued ticket: credit or annul; built on the owner's decision). Q19 stays
  open.

- **Task 6 (#818) and C50 (#847): the ticket of a bill collected after a correction still shows the
  original invoice total.** **PARKED (owner, 2026-09-29)** until the product can issue a corrective
  invoice; the owner's points for that design are on the corrective-invoice entry (R5, above). Left
  open by the table actions plan.
  [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)

- **"the fiscal record is built from `total` + `vat_breakdown`" is a false-narrow enumeration, and
  it reproduces itself.** Two compliance-track documents carry the same shape about tips
  (`docs/compliance/asesor-questions.md:465`, `docs/compliance/verifactu-findings.md:678`). **Next
  action:** whoever next works the compliance track widens those two sentences.
  [Detail](backlog/fiscal.md#the-fiscal-record-is-built-from-total--vat_breakdown-is-a-false-narrow-enumeration-and-it-reproduces-itself)

- **Overlap with A231d (invoices by email)** — left open by W111 (#1261, the receipt's top block —
  logo, address, phone, email and slogan): its approved design adds a contact email and optional
  phone to the location's settings; the venue-wide `phone` and `email` above already exist, so
  whoever builds A231d decides whether to reuse them rather than add a second contact email.

- **One original per invoice, structurally.** F2 requests to `POST /api/sales/:id/receipt` still
  have no limit or idempotency; two calls produced three unmarked originals, and art. 14.1 says
  exactly one. **Remaining:** contain repeated F2 requests per sale, with the invoice number on the
  slip. [Detail](backlog/fiscal.md#one-original-per-invoice-structurally)

- **`packages/fiscal-verifactu/src/privileges.expected.ts` still lists `department_hours`** — left
  open by the reviews of A261 step 5 (Hours, #1298); the file is a frozen record of the old grants
  and was not edited.

- **Installing or renewing the AEAT certificate after setup.** Only the setup wizard can set it
  (`apps/server/src/setup-api.ts`), and nothing watches when it expires. Needs a view, renew and
  replace surface and an expiry alert. Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#installing-or-renewing-the-aeat-certificate-after-setup)

- **VAT at line add (M7v, A68).** — left open by the menus plan. Asesor Q26 (the rate on the day of
  issue) is open. The till computes a basket VAT split (`vatBreakdown`,
  `apps/till/src/state/working-order.ts`) that no screen shows.
  [Detail](backlog/fiscal.md#vat-at-line-add-m7v-a68)

- **Nothing in the product can issue a corrective invoice (R5, _factura rectificativa_) for a VAT
  error on an issued simplified invoice.** — left open by the menus plan. The owner also needs a way
  to correct an issued invoice when a customer spots an error after payment, regardless of the
  future Tabs · Bill choice (2026-10-04, A261 step 2 decision).
  [Detail](backlog/fiscal.md#nothing-in-the-product-can-issue-a-corrective-invoice-r5-_factura-rectificativa_-for-a-vat-error-on-an-issued-simplified-invoice)

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live
  filing.** Asesor question Q20 asks which intended cases belong in `S1` and which need `N1` or
  `N2`, and whether the label should read "IVA 0%" rather than "Sin impuestos". **Non-blocking while
  pre-production; blocking before going live.**
  [Detail](backlog/fiscal.md#no-tax-0-is-an-open-fiscal-question-and-it-must-be-answered-before-the-first-live-filing)

### The setup wizard, onboarding and the demo venue

_Formerly A2 and B1._ Detail: [backlog/setup.md](backlog/setup.md).

- **`#onGoto` in `setup-app.ts` keeps `fiscalTestStatus`** — found by #567 while pruning comments.
  The done screen treats a non-network status refusal as ready, so an HTTP 503 can announce "The
  server is ready" early. [Detail](backlog/setup.md#ongoto-in-setup-appts-keeps-fiscalteststatus)

- **The bucket route answers a wrong key (`recovery.passphrase_invalid`) and a damaged copy
  (`backup.artifact_invalid`, `backup.archive_invalid`) with different codes;** the wizard shows one
  sentence for all three, as the command line does. Left open by SQLite slice 2 Task 9c (#646,
  "Restore from my bucket" in the setup wizard).

- **The first, unconfirmed attempt downloads the whole copy only to show whose it is,** and the
  confirmed attempt downloads it again; the HTTP request stays open for the whole download. Left
  open by SQLite slice 2 Task 9c (#646, "Restore from my bucket" in the setup wizard).

- **Walked in the browser test harness against a stubbed server, not yet on a running box.** Left
  open by SQLite slice 2 Task 9c (#646, "Restore from my bucket" in the setup wizard).

- **After an archive restore or a Cloud restore the final screen does not show the device steps the
  bucket rebuild's shows** (`rebuilt` is set only on the bucket path,
  `apps/setup/src/setup-app.ts`), although the first start re-issues the certificate for this
  machine's addresses after an archive restore too. Left open by SQLite slice 2 Task 9c (#646,
  "Restore from my bucket" in the setup wizard).

- **After a refused Cloud restore the owner has to tick the Cloud screen's "old server and surviving
  peers are stopped" confirmation again.** Left open by SQLite slice 2 Task 9c (#646, "Restore from
  my bucket" in the setup wizard).

- **The name-constrained-CA model does NOT protect a personal Android phone** (spike 2026-09-08): a
  user-installed root is trusted for every name on Android, while desktop Chrome and iOS/Safari honour
  the constraint. The service-worker/PWA/WebAuthn-blocked-until-trusted behaviour and an iOS device
  are still to measure. [Detail](backlog/box.md#box-image-constraints-b3)
  **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to
  run. [Detail](backlog/setup.md#androidios-on-device-install-and-trust-rows)

- **A Demo's "Casa Delgado" stays in the draft when the operator switches to Prepare or Live**
  (whether this is wanted is not recorded; it sits among the wizard's constraints). The location
  name is not on the list leaving Demo clears (`#onPatch`, `apps/setup/src/setup-app.ts`). There the
  location-name field starts filled in but takes its hint, which the filled value hides, and no "?",
  because `#field` (`apps/setup/src/screens/venue-screen.ts`) chooses the "?" by Demo mode alone.
  [Detail](backlog/setup.md#setup-wizard--the-constraints-a2s-rework-left-behind-a2)

- **OWNER DECISION, open since #443: should the setup wizard still OFFER "Add a mirror node"?** But
  the option is still there and the flow still runs, so an operator can still spend a box on it.
  Removing or disabling it until slice 3 lands the replacement is a product call, not a wording one.
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

- **Live production recovery and continuous complete-server recovery remain open.** The restore
  choice now includes guided Cloud recovery of a verified test-venue snapshot. The replacement shows
  the pairing code and approved capture time, then requires an explicit local restore.

- **Open owner call — setup always stores a language on the account.** If the browser sends no
  language, or one Waitron does not ship, the account gets the venue's language saved as though
  chosen — so the stored value cannot tell "chose Spanish" from "said nothing", and it does not
  follow a later change to the venue default. Keep this, or store a language only when the browser
  asked for one?
  [Detail](backlog/setup.md#open-owner-call--setup-always-stores-a-language-on-the-account)

- **The configuration preview names what it will copy by database table** — left open by C42
  (#837). The names come from each module's `configuration-transfer.ts` list; about fifty can
  arrive. Give them operator words, grouped, or keep the table names.
  [Detail](backlog/setup.md#the-configuration-preview-names-what-it-will-copy-by-database-table)

- **The Review screen scrolls sideways at 390px** when a value is long (a 56-character email made
  it 530px wide in English, 537px in Spanish): its `auto 1fr` columns never narrow below the
  longest value. Left open by C42 (#837).

- **The Cloud restore screen shows capture and expiry times as the server's raw ISO text** in both
  languages, and the Review screen shows invoice languages as codes. _(C113, #1014: one code now.)_
  Left open by C42 (#837).

- **The Spanish certificate export steps name Chrome, macOS and Firefox menus from memory**
  ("Gestionar certificados importados de Windows", "Acceso a Llaveros", "Sus certificados"…), and
  the FNMT links still open FNMT's English pages. Check them on real Spanish systems with the item
  below. Left open by C42 (#837).

- **The certificate export help has never been followed on a real machine** — still open after
  #334. Nobody exported a certificate through Windows', macOS' or Firefox's own certificate store
  while reading the new guidance, so the instructions are unverified against the thing they
  describe.
  [Detail](backlog/setup.md#the-certificate-export-help-has-never-been-followed-on-a-real-machine)

- **Switching setup mode does not clean up what the server already holds** — still open after
  #334. If someone fills in Demo, Prepare or Live far enough that the server has stored part of
  that answer and then switches mode, what the server kept is untested — write a test that stages
  configuration in one mode, switches, and asserts what survives.
  [Detail](backlog/setup.md#switching-setup-mode-does-not-clean-up-what-the-server-already-holds)

- **The setup app's catch-all redirect was not proven by deleting it** — still open after #334.
  The reviews checked this by running the route tests and the full server suites, not by removing
  each exclusion one at a time and watching a test fail, and no separate probe confirmed the trading
  app is untouched by the redirect.
  [Detail](backlog/setup.md#the-setup-apps-catch-all-redirect-was-not-proven-by-deleting-it)

- **A draft carrying a country with no venue-setup pack** — found while bringing `apps/setup` to
  the coverage bar (2026-09-23), left unfixed. It shows Spain in the country select while the
  screen holds the other value, so "Check the country." sits beside what looks like a valid choice.
  [Detail](backlog/setup.md#a-draft-carrying-a-country-with-no-venue-setup-pack)

- **A fiscal test or a provision that answers after the wizard has been removed from the page
  leaves it stuck when it is put back** — found while bringing `apps/setup` to the coverage bar
  (2026-09-23), left unfixed. The app mounts the wizard once and never removes it, so this may be
  unreachable in use.
  [Detail](backlog/setup.md#a-fiscal-test-or-a-provision-that-answers-after-the-wizard-has-been-removed-from-the-page-leaves-it-stuck-when-it-is-put-back)

- **In Demo, a server refusal of a field Demo hides can only be retried unchanged** — a Demo gap
  on the setup wizard's venue screen as it stands after C47s (#840), left unfixed. Whether the
  server ever refuses Demo's fixed series codes is not established.
  [Detail](backlog/setup.md#in-demo-a-server-refusal-of-a-field-demo-hides-can-only-be-retried-unchanged)

- **In Demo with a draft country that has no venue-setup pack** — a Demo gap on the setup
  wizard's venue screen as it stands after C47s (#840), left unfixed. The screen says from the
  start that Demo's invoice settings have not loaded, even when they have (the unknown country names
  no filing module to take a description from), and Next only moves focus to that sentence.
  [Detail](backlog/setup.md#in-demo-with-a-draft-country-that-has-no-venue-setup-pack)

- **In Demo, a local check that fails only on a field Demo hides** — a Demo gap on the setup
  wizard's venue screen as it stands after C47s (#840), left unfixed. All of this was read in the
  code, not run; whether a real draft can reach that state has not been tested.
  [Detail](backlog/setup.md#in-demo-a-local-check-that-fails-only-on-a-field-demo-hides)

- **A refused backup-file input on the backup restore screen gets no red outline — OPEN.** The
  screen's own styles have no rule for an invalid input (seen in screenshots of the refused state
  during A151). The recovery key and recovery kit moved to `wt-input` and `wt-textarea` in A178d,
  which draw their own invalid state (read, not run), so the backup-file input is what is left.

- **A venue's time zone must come from its country pack's list (A166, owner 2026-10-01)** — OPEN.
  Readers then disagree about a bad zone: reporting throws, bookings falls back to Madrid, account
  emails to UTC. **Wanted:** each country pack lists the zones it allows (Spain: Madrid and Canary),
  and creation/provisioning writers refuse a zone not on its country's list.
  [Detail](backlog/setup.md#a-venues-time-zone-must-come-from-its-country-packs-list-a166-owner-2026-10-01)

- **Remaining "?" buttons that should be hints (A237, owner 2026-10-03)** — OPEN. The rule — a
  short explanation is the field's hint, and the "?" button is only for one too long for a hint or a
  field that starts filled in — was applied to the setup wizard's first four screens only, and
  nothing enforces it. Other screens' "?" buttons were not reviewed against the rule.
  [Detail](backlog/setup.md#remaining--buttons-that-should-be-hints-a237-owner-2026-10-03)

- **No test covers the setup review screen's value cell's own centring** — left open by A243
  (W33, #1143). Removing it alone leaves all 31 review-screen tests green, because it changes
  nothing until a label is taller than its value (a label wrapping onto two lines).
  [Detail](backlog/setup.md#no-test-covers-the-setup-review-screens-value-cells-own-centring)

- **The demo venue's departments' internal names still follow the seed language.** Left open by
  W108 (#1276, the demo venue's names and tax ID come from the country pack).

- **Still open from W109-5's Barcelona look (2026-10-07):** product groups and prep stations
  stay English under Spanish staff-facing dish names (the plan's known limit). Stored practice sales
  cannot be reprinted or looked up on the till: both look a sale up through its till order, which a
  practice sale does not have (the look's reading, not checked against the code).

- **The demo's Drinks section labels in Catalan and Galician are drafts awaiting a speaker's
  check**, like W109-3's text below. Left open by A321 (the demo's included Drinks menu opens onto
  four sections).

- **The demo data carries Catalan and Galician text (W109-3, #1321, Task 3 of the same plan) — DONE;
  the text is UNCHECKED by a speaker (owner decision 4, 2026-10-06) — OPEN.** A speaker of each
  should read it.
  [Detail](backlog/setup.md#the-demo-data-carries-catalan-and-galician-text-w109-3-1321-task-3-of-the-same-plan--done-the-text-is-unchecked-by-a-speaker-owner-decision-4-2026-10-06--open)

- **A guided tutorial for Demo and Preparation (A250, owner 2026-10-03)** — OPEN, partly designed,
  not to be built yet (owner: "we just mustn't forget it"); needs a spec before queueing. A
  walk-through that teaches a new user what to set up and in what order — devices, printers, device
  profiles, and the other settings a venue needs before it trades — shown in Demo and Preparation
  (`onboardingIntent` `demo` and `prepare`).
  [Detail](backlog/setup.md#a-guided-tutorial-for-demo-and-preparation-a250-owner-2026-10-03)

- What A2's rework left as constraints on the next change to the wizard is under [Setup wizard — the
  constraints A2's rework left
  behind](backlog/setup.md#setup-wizard--the-constraints-a2s-rework-left-behind-a2).

- A configuration imported at setup replaces the default "Entry error" cancel reason with the
  imported venue's reasons, so importing from a venue with none leaves the new venue with none, and
  the till's dialog then says so (`adjust.no_reasons`); whether setup should add the default after
  such an import is the owner's to decide. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **The till's "This device hasn't trusted the till yet" page has never been seen on a real
  device.** **Next action:** during the on-device trust rows above, click past the certificate
  warning on one device and confirm the page appears.
  [Detail](backlog/setup.md#the-tills-this-device-hasnt-trusted-the-till-yet-page-has-never-been-seen-on-a-real-device)

- **The look left a switched-off printer named "A331 look Epson" (the owner's Epson at
  192.168.10.81) in the shared demo venue.** Left open by A331 batch 3b (#1415).

- **Setup's recovery kit lost `autocomplete="off"`, which `wt-textarea` does not offer** — left open
  by A178 (#1010 to #1019), seen while building, not changed.

### Menus and the catalogue

- **Modifiers' Spanish "Opciones" tab was cut at a 310 px screen on CI's Linux fonts** in
  A424 (#1452). A434's macOS Chromium probe measured the whole tab at screen widths 310 and
  390 px (tab 95.67 px; strip 106.42 and 186.42 px). The owner has not ruled on Modifiers;
  reproduce with the Linux fonts before choosing a change. The Printers tab's shorter label
  was the separate A434 ruling.

_Formerly the catalogue and menus entries in the opening part of the old Track A (before A1), and the catalogue entries filed under A2; part of A9._ Detail: [backlog/catalogue.md](backlog/catalogue.md).

- **Menu-root default fallback when content languages are unset (A420 review).**
  `updateMenuDetails` validates against English; section and include-folder writers use
  their supplied venue fallback. Decide whether the menu-root writer should take that
  fallback too. `content-translations.test.ts`, “existing menu, section and folder checks
  expose the unset default fallback”, exercises the difference. Inline saves already use
  their resolved venue context.

- **Translation report excludes image names (C122, #1006).** The media module's
  `contentTranslations` seat supplies only a kind and an id. Showing a name or editor link needs
  a separate seat design that respects module boundaries; no change is queued.

- **Decide whether untranslated staff-name fallback belongs in the gap report (C122, #1006).**
  Names absent in every language are listed under non-default languages, but not the default.
  The owner must decide whether that is useful for venues using only staff names, including a
  Barcelona venue with Spanish staff names and Catalan as default. A172 left the report unchanged.

- **Sections lack direct editor addresses (C122, #1006).** The report links a section to its
  menu's Structure tab. A420 part 2 replaces that journey for translation edits; other section
  navigation still needs its own decision.

- **The `media_images` filename CHECK accepts a name with an embedded NUL**: the review stored 64
  hex characters, `.png`, a NUL and `evil` (73 bytes) on `node:sqlite`, because `substr` stops at
  the NUL; closing it needs a migration. Found by #609 (`packages/media`), not fixable in a
  comments-only change.

- **`mergeAllergenMaps` (`src/derivation.ts`) can list a source twice and order sources differently
  from run to run** — found by #603 while pruning comments. The comment now says so; the code is
  unchanged.
  [Detail](backlog/catalogue.md#mergeallergenmaps-srcderivationts-can-list-a-source-twice-and-order-sources-differently-from-run-to-run)

- **The media library still reads every matching image for search and name sorting, inside the venue
  write lock** — OPEN (found 2026-09-23, task F1's review wave). The route (`GET /management-api/images`)
  uses `withTransaction`, the venue's exclusive write lock, so these remaining scans can delay a
  sale. **Next action:** decide how far to push search ranking into SQL; measure a way to bound name
  sorting without changing its results.
  [Detail](backlog/catalogue.md#the-media-library-still-reads-every-matching-image-for-search-and-name-sorting-inside-the-venue-write-lock)

- **A negative catalogue price can still be stored by a direct call** — OPEN (left by #487).
  `createProduct` and `updateProduct` (`packages/catalogue/src/operations.ts`) still accept and
  store a negative when called directly — a seed, a script or a future caller — and
  `products.unit_price` carries no `>= 0` check.
  [Detail](backlog/catalogue.md#a-negative-catalogue-price-can-still-be-stored-by-a-direct-call)

- **Two price rules disagree about a value that is not negative** — OPEN (found 2026-09-21, task
  N4). **Next action:** decide whether one rule should govern every catalogue price, and if so which
  — and check each dashboard form against it before changing the server, since a server stricter
  than its own form is the failure #485 met.
  [Detail](backlog/catalogue.md#two-price-rules-disagree-about-a-value-that-is-not-negative)

- **Cases the content-language decisions leave open, built with the plan's default unless the owner
  says otherwise** (plan, "Open points"): a Spanish venue with no known province requires nothing
  (setup cannot create one; the owner's reason for Spanish leans towards requiring it there too);
  receipts outside Catalonia stay free, Spanish by default. Left by W109 (#1320, #1322); the
  decisions are in [products.md](developers/products.md#content-languages-per-region).

- **Between 30rem and 50rem a long menu name can still make the Menus table wider than its box**, so
  the end of the live version's time scrolls under the pinned Actions column; the link and the row
  menu stay in view. Left open by W87 (#1191).
  [Detail](backlog/catalogue.md#menus-list-changes-column-and-top-aligned-rows-w87-1191-left-open)

- **In the Menus list's middle layout the Status column, and on a phone the Name column, hold the
  Unpublished changes link but do not set `activatesRow: false`**, so a click beside the link opens
  the menu; the design system records this as a deviation from its `activatesRow` rule, and whether
  it stays is the owner's call. Left open by W87 (#1191).
  [Detail](backlog/catalogue.md#menus-list-changes-column-and-top-aligned-rows-w87-1191-left-open)

- **The product list's "Made at" column (`apps/dashboard/src/widgets/product-list.ts`) also does not
  set `activatesRow: false`**, so, judging by the code (not run), a click beside a short station
  name opens the product editor, which the `activatesRow` rule in `docs/developers/design-system.md`
  forbids. Left open by W87 (#1191), for an item of its own.
  [Detail](backlog/catalogue.md#menus-list-changes-column-and-top-aligned-rows-w87-1191-left-open)

- **A menu's Structure tab is one tree (W88, #1209): not checked** — in Spanish at 390 px the Type
  column scrolls partly under the pinned Actions column, which is the table's own sideways scroll;
  the heading's height with "Checking…" or "Could not be checked" was not measured against the other
  states.
  [Detail](backlog/catalogue.md#a-menus-structure-tab-is-one-tree-w88-1209-not-checked)

- **When the venue needs a reset, the menu editor shows the "reset the venue" sentence inside the
  brackets beside the menu's name**, where the live version normally sits, in muted text. A review
  suggested a line of its own; kept in the brackets by decision. Left open by A335 (#1457).

- **A menu never published gets no star on its Preview tab**: only a menu whose working copy differs
  from a live version shows "Preview*", as the Menus list's Changes column already does. Whether a
  never-published menu should show one too is the owner's call. Left open by A335 (#1457).

- **Not checked: the Price overrides tab on the running dev stack** — a real save and the re-read
  after it, and Undo against the real server (the look in Chromium used mounted widgets only). Left
  open by W89 (#1239).
  [Detail](backlog/catalogue.md#a-menus-prices-are-one-editable-price-overrides-field-per-row-w89-1239-left-open)

- **A size with its own price decides whether its clash comes from its product by matching the two
  clashes**, which can be misread in a rare setup where they match exactly — telling them apart
  needs the prices read to say which level a clash came from. Left open, raised in #1239's review
  (W89) and not taken.

- **In the Structure tree, closing the section form opened from a section's swatch puts focus on the
  row's ⋮ menu** rather than back on the swatch that opened it. No test pins it. Left open by W92
  (#1250).

- **At 390 px the Structure tree clips a long product name under the pinned Actions column**, so a
  long name's swatch needs a sideways scroll to reach; since A294 this no longer applies to
  sections, and it stays open for products. Left open by W92 (#1250).
  [Detail](backlog/catalogue.md#a-product-has-one-colour-everywhere-w92-1250-left-open)

- **A339 test-fixture follow-up:** `apps/dashboard/src/api/menu-read-controller.test.ts` and
  `live-queries.test.ts` still use handheld five/six in fake snapshots, including three distinct
  snapshots in the invalidation cases.
  [Detail](backlog/catalogue.md#each-menu-has-one-device-home-page-w93-1287-left-open)

- **The Home page tab's Till preview draws the menu at the frame's full width, but on a real till
  the menu shares the screen with the order**, so the Till preview can show up to about four more
  columns than the till does. Not changed, because the real width depends on the till screen's
  layout. Left open by W93 (#1287).
  [Detail](backlog/catalogue.md#each-menu-has-one-device-home-page-w93-1287-left-open)

- **On the Home page tab, a shortcut's ⋮ still opens while a save is out** (its Remove is disabled,
  as the Structure tree's was). The plan wanted the ⋮ itself disabled, but `wt-row-actions` lost its
  `disabled` option in A359 (#1360). Owner to choose: bring the option back, or keep this. Left open
  by A336 (#1458).

- **On the Home page tab, a missing shortcut and one devices do not show look alike**: both are
  dashed and muted and differ only in their words ("Missing: <name>" against "Not shown on
  devices"), because the dashboard has no warning icon. Left open by A336.

- **Configuration export/import still leaves publications behind.** Reset the venue instead of
  republishing old menus. Left open by A291 (2026-10-06, removed format-2 preview/republication).
  [Detail](backlog/catalogue.md#each-menu-has-one-device-home-page-w93-1287-left-open)

- **The dashboard's Home page preview (`apps/dashboard/src/widgets/device-home-preview.ts`) is a
  hand copy of the till's menu browser** (`apps/till/src/widgets/menu-browser.ts`). A change to the
  till's tiles has to be repeated by hand, and no test sees the two drift apart. Proposed follow-up:
  move the shared logic and CSS beside `arrangeHome` in `packages/catalogue/src/device-home.ts`.
  [Detail](backlog/catalogue.md#each-menu-has-one-device-home-page-w93-1287-left-open)

- **A Products drag: a category deleted elsewhere before this screen refreshed is still sent**, and
  what the server answers to it is not checked. Left open by W88a (#1228).

- **Two copies of the tree pointer drag — OPEN (W88).** Each widget still has its own copy of the
  drag itself. A shared helper, told how to map a row to a target, would serve both.
  [Detail](backlog/catalogue.md#two-copies-of-the-tree-pointer-drag--open-w88)

- **The Menus Structure tree notices Collapse all only by watching its table redraw — OPEN (W88).**
  An event from the table for "these branches changed" would be cleaner; it means a change in
  `packages/ui`.
  [Detail](backlog/catalogue.md#the-menus-structure-tree-notices-collapse-all-only-by-watching-its-table-redraw--open-w88)

- **"Open <menu>" in an included menu's ⋮ can be followed while the tree is busy — OPEN (W88).** The
  other items in the tree's row menus are greyed out while a change is out; the link to the included
  menu's own editor is a link, which has no greyed-out state, so it stays live. (A322 renamed it
  from "Edit <menu>", so that the include's own Edit could sit beside it.)

- **A folder's fixed photo shows on the till only in Thumbnails mode**, as a section's photo does.
  Left open by A322 (#1372, an included menu can show its sections directly).

- **A home shortcut to a menu that is included in two lists of one menu opens the top-level copy**,
  else the copy indexed last. Left open by A322 (#1372).

- **Renaming or clearing the included menu's own customer names is not checked against the folders
  that fix some languages**, so a folder can end up with no name in the default language. The
  missing-translations report lists it, and changing the default language is refused while it lasts,
  but the write that caused it is allowed. Left open by A322 (#1372).

- **A fixed value that happens to equal the included menu's value when the dialog opens is saved
  back as "follow" the next time the dialog is saved**: the dialog compares with the included menu's
  value and cannot tell the two apart. Left open by A322 (#1372).

- **The live photo triggers for products and sections (media `0005` to `0007`) look up
  `products.image` and `sections.image`, which no index covers.** Its own item: a performance fix
  with a media migration. Left open by A322 (#1372).
  [Detail](backlog/catalogue.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open)

- **A configuration import stores a fixed folder name as given, spaces included**, where a save
  through the dialog or the route trims it. A name of spaces only shows as no name either way. Left
  open by A380 (#1385).

- **After browser Back to another menu with no edits made, the include's Edit dialog stays open over
  that menu**, as the section Edit dialog does: choosing another menu does not close either (read in
  `menus-screen.ts`, not run). Left open by A380 (#1385).

- **At 375×667 the Products table's box gave few rows, short of the item's "enough rows to remain
  usable"**, and a larger minimum does not fit that screen without the toolbar scrolling away; no
  kept test covers Select and move mode there. Whether that is enough rows is the owner's call. Left
  open by W80 (#1187); A303 changed the layout and the 375×667 selection measurement has not been
  retaken.
  [Detail](backlog/catalogue.md#products-table-toolbar-and-headings-stay-in-view-w80-1187-left-open)

- **A desktop window narrow enough to leave the Products table under 768px gets the full-screen
  Filters panel** — at which window width that happens with the sidebar shown was not measured. Left
  open by W83 (#1193).
  [Detail](backlog/catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)

- **The Products 768px side-panel threshold is tied by hand to token sizes** (768 − 7×44 − 12 = 448,
  just above the table's 440px narrow-tree width). Left open by W83's review (#1193), not started.

- **Not covered: Select mode's extra controls at the middle widths** of the Products toolbar. Left
  open by W85d (#1249, the toolbar takes two lines at phone width, not three).

- **Not covered by W85b: while a category is being renamed, its count and asterisk follow the name
  box and are not capped.** Left open by W85b (#1243).
  [Detail](backlog/catalogue.md#products-at-phone-width-a-long-name-runs-under-the-pinned-actions-column-w85b-w85c-w85e-left-open)

- **Products at phone width: what W85e left for the owner** (the owner's answer to W85b's open point
  was a "maybe"): keep, or undo, either half; hide the folder icon too at phone width so product and
  category names line up again (since A294 that slot holds the category's colour square, so this now
  means moving or hiding the square); narrow the indent step. Left open by W85e (#1275).
  [Detail](backlog/catalogue.md#products-at-phone-width-a-long-name-runs-under-the-pinned-actions-column-w85b-w85c-w85e-left-open)

- **Catalogue names (W72): there is no unique index, and no backfill.** A row whose name has not
  been written since the column was added keeps a null key, and the check does not see it until its
  name is next written (every product editor save writes it) or the venue is reset. Stored data is
  not renamed: a venue that already holds duplicates keeps them until someone renames one.
  [Detail](backlog/catalogue.md#catalogue-no-two-categories-with-one-parent-and-no-two-active-products-share-a-name-w72-to-w72h-left-open)

- **The Menus screen's two category pickers match only the text the list shows, so a path finds its
  category there only when typed with " › "**; one category's name alone still finds it. Those
  pickers are the shared `wt-combobox`, which was left unchanged. Left open by W82 (#1210, the Move
  dialog's destination categories; W82b, W82c).

- **A category's Made at link is the same `maker-link` as a product's, so the missing `activatesRow:
  false` recorded under W87 applies to category rows too** (there a click beside the link opens or
  closes the category; judged from the code, not run; its contrast is fixed with the product's by
  A306, through the same style rule, not measured on a category row). Left open by W86 (#1203).

- **A person who may not read routing sees "Kitchen routing unavailable" on every category**,
  because a refused read counts as a failed one. Left open by W86 (#1203, a category's Made at).

- **One writer still skips the required-language check (`content.language_required`) — OPEN.**
  The Prepare-to-Live configuration copy (`packages/catalogue/src/configuration-transfer.ts`)
  copies the saved row as it is, unplanned. The demo seed
  (`apps/server/scripts/demo-seed/seed-catalogue.ts`) runs the check since W109-4 (#1322).

- **A "Translate all" service from Waitron Cloud — OPEN, unqueued (owner 2026-10-06 ~17:23).** A
  paid subscriber service in Waitron Cloud (the separate service, not this repository) that
  translates every missing customer-facing name in one go; this repository would only call it,
  behind the subscription. A machine translation needs the venue's review before a diner sees it.

- **A customer-facing name with no text in the default language prints a blank goods line — OPEN
  (found 2026-10-01 by C122).** No save path writes such a row today (product and variant saves
  refuse it), only a direct write. It shows under the default language in the Missing translations
  list. [Detail](backlog/catalogue.md#a-customer-facing-name-with-no-text-in-the-default-language-prints-a-blank-goods-line--open-found-2026-10-01-by-c122)

- **`joinCustomerPresentationText` passes the requested language where the default belongs — OPEN
  (found 2026-10-02 by A172, not measured).** The receipt fills the variant's text per receipt
  language before it gets there (`apps/server/src/working-order.ts`), so whether any surface shows
  the difference is unknown; reproduce before fixing. [Detail](backlog/catalogue.md#joincustomerpresentationtext-passes-the-requested-language-where-the-default-belongs--open-found-2026-10-02-by-a172-not-measured)

- **The default-change check counts deleted and switched-off things — OPEN (noted 2026-10-01 by
  C122; I believe this predates the branch).** `listContentTranslationGaps`
  (`packages/catalogue/src/content-languages.ts`) has no `active` filter on top-level products,
  options lists, extras lists or a menu's sections, and keeps a variant whose product is deleted, so
  a deleted product's partly translated name blocks a change of default while the Missing
  translations list leaves it out. [Detail](backlog/catalogue.md#the-default-change-check-counts-deleted-and-switched-off-things--open-noted-2026-10-01-by-c122-i-believe-this-predates-the-branch)

- **Menu draft/published state** and time-of-day / seasonal scheduling.

- **Language resolution follow-ons** — there is still no single shared rule: the receipt's
  `lineName` (`apps/server/src/receipt-ticket.ts`) and the kitchen ticket's `ticketName`
  (`apps/server/src/kitchen-print.ts`) try the exact language and then take the first stored one.
  [Detail](backlog/catalogue.md#language-resolution-follow-ons)

- **Product folders, menus that include menus, and prep station routing: partly built (design
  approved 2026-09-30).** The
  [design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) is built in slices. The
  delete dialog counts the routing cells removed but lists no products whose destination changes,
  and **Move to…** changes folder ancestry without a routing preview.
  [Detail](backlog/catalogue.md#product-folders-menus-that-include-menus-and-prep-station-routing-partly-built-design-approved-2026-09-30)

- **Sales classification and the menus plan — what they left open.** `Product.categoryId` and
  `primaryCategoryId` always hold the same value, and `?descendants=1` on a category's products has
  no dashboard caller.
  [Detail](backlog/catalogue.md#sales-classification-and-the-menus-plan--what-they-left-open)

- **Copying some of a section's products into another section is not built** (found by the menus
  plan's closing sweep, 2026-09-27). What landed is duplicating a section and §10.2's Add products
  flow. **Next action:** the owner decides whether §10.2's flow replaces §2's copy.
  [Detail](backlog/catalogue.md#copying-some-of-a-sections-products-into-another-section-is-not-built)

- **The Structure tab's Select mode cannot delete sections in bulk (A337)** — Remove from menu stays
  disabled while a section the menu owns is selected, because such a section is deleted, not
  removed; each is still deleted from its own row's ⋮. **Next action:** the owner says whether a bulk
  Delete is wanted.

- **The Structure tab's toolbar and Select mode: four wording and look points left for the owner
  (A337, #1471)** — the Remove dialog asks "Remove N items from their sections?" under a button
  saying "Remove from menu"; the toolbar's Add menu offers "New section here", where "here" is the
  top level; the toolbar "+" has no border; "Move to section…" is primary where the Products tree's
  Move is secondary. Nobody has looked by eye at the empty-menu box or the Available filter's panel.
  **Next action:** the owner picks the wording and looks; each is a small change in
  `apps/dashboard/src/i18n/strings.ts` or `menus-screen.ts`.

- **Dragging into a section on the Structure tab: two look points left for the owner (A338,
  #1475)** — while a row is dragged over the middle of a closed or empty section, that section is
  marked only by the Products tree's thin bar on the row's left edge (`drop-target`,
  `treeDragStyles` in `apps/dashboard/src/widgets/tree-drag.ts`), which is faint and far from the
  pointer; and the dashed "drop before" line looks thinner in the pinned ⋮ column, which I believe
  predates A338 (its gap styling was not changed) but nobody checked on `main`. Screenshots:
  lane C's `a338-shots/` (`1-`, `2-`, `4-`, `8-`). **Next action:** the owner says whether the
  drop-into mark should be stronger in both trees, and someone checks the ⋮-column line on `main`.

- **Content languages and the image library (#339, #344) — what is left open.**
  [Operator guide](content-and-images.md). **A new picture consumer has to add a real database
  reference, not just store a filename.** **The online language selector has nothing to select for
  yet.**
  [Detail](backlog/catalogue.md#content-languages-and-the-image-library-339-344--what-is-left-open)

- **The upload limit is 20 MB (owner decision 2026-09-23).** It bounds how large an upload the
  server will buffer; the decode is bounded by `MAX_INPUT_PIXELS` (100 million). What current
  phones produce has not been measured. Left open by photos shrunk on upload (#543).

- **The library grid loads the full 1600-pixel copy for each tile**, 24 photos a page
  (`packages/media/src/dashboard/image-library.ts`), about 4 MB at the average size. **Next
  action:** decide whether the grid needs a thumbnail copy for slow Wi-Fi. Left open by photos
  shrunk on upload (#543).

- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.** `withTransaction` admits one write transaction per venue file
  (`packages/catalogue/src/categories.ts`, above `listCategories`). **Next action:** measure it
  before anyone widens category authoring to more concurrent editors. Left open by product
  categories (#340, [API and integration guide](developers/product-categories.md)).

- **Extras and Options — deliberate limits, and what is left open.**
  [integration contract](developers/modifiers.md). **Clearing the Extras editor's Minimum choices
  box saves 0** (the save format's own default); the A66 plan's Review Focus item 3 reads as if a
  cleared minimum should be refused. Open for the owner.
  [Detail](backlog/catalogue.md#extras-and-options--deliberate-limits-and-what-is-left-open)

- **Image library (#547's review, `packages/media/src/dashboard/image-library.ts` and
  `image-picker.ts`).** (1) When the picker is handed a new live-data source, the library keeps
  listening to the first one until its next load. (2) The delete confirmation's Close button has no
  in-flight check of its own and relies on being drawn disabled. From "Review points left for the
  owner".
  [Detail](backlog/catalogue.md#image-library-547s-review-packagesmediasrcdashboardimage-libraryts-and-image-pickerts)

- **The translation gap report (`listContentTranslationGaps`,
  `packages/catalogue/src/content-languages.ts`) counts "Spanish filled, English blank" as a gap**;
  whether it is still a gap once English falls back to the Spanish name is a decision to make with
  the owner before building (A172 left the report unchanged). Left open by A172 and A172b (a name
  field's hint shows what a blank field will actually use, #1053, #1061).

- **The Price heading reads "Price per portion" also over a row sold by the unit.** Still open from
  its review: neither screen counts a stored unit seeded as `each` as Each, which `isEachUnit`
  (`packages/catalogue/src/units.ts`) does; no code outside tests seeds one. Left open by W75 (the
  Extras editor shows Portion beside Price, #1194).

- **A name stored under a regional code such as `en-GB` is read by the forms as the plain code
  first, then its regional ones** (`languageText`, `apps/dashboard/src/widgets/form-fields.ts`). A
  till or receipt asking for `en-GB` reads `en-GB` before `en`, so a map holding both can show one
  name in the form and serve the other. Left open by W77 (#1197; W77a #1206).
  [Detail](backlog/catalogue.md#a-name-stored-under-a-regional-code-such-as-en-gb-is-read-by-the-forms-as-the-plain-code-first-then-its-regional-ones)

- **A product literally named `Gin (Double)` and `Gin`'s `Double` variant have the same display
  label**; saved/imported raw names satisfy the requested scopes. Choose distinct saved names for
  now. Any future restriction on composed labels needs an owner decision about the naming policy.
  Left open by A357 (relative variant names, #1381).
  [Detail](backlog/catalogue.md#a-product-literally-named-gin-double-and-gins-double-variant-have-the-same-display-label)

- **At phone width in a right-to-left layout, a long name in the Products list can run under the
  pinned Actions column** (`#fitNames`, `apps/dashboard/src/widgets/product-list.ts`, measures the
  room from the left). Found by A330's Codex review and reproduced by it on `main` before #1354. Not
  fixed; next: a browser test at 390 px with `dir="rtl"` and a long unbroken name. Left open by
  A330 (variant rows show their photo, #1354).

- **The Price overrides tab's save message comes after the whole table in tab order, so a keyboard
  user cannot reach Undo from a field within its 5 seconds** (decided as built, not tested with a
  user). Options: a keyboard shortcut for Undo, or a message that waits while focus stays in the
  field it saved. Left open by A343 (a menu's Price overrides tab tidied, #1368).

- **In Spanish a range's placeholder reads "8.00 – 12.00" with full stops, and a refused field is
  drawn about 14 px wider than the others** (seen in #1368's screenshots). A344 removed the "?" and
  the Resolve column and keeps each price box on screen at 390 px; the wider refused field and the
  placeholder's full stops were not re-checked. Left open by A343 (#1368).
  [Detail](backlog/catalogue.md#in-spanish-a-ranges-placeholder-reads-800--1200-with-full-stops-and-a-refused-field-is-drawn-about-14-px-wider-than-the-others)

- **Closing a refusal's message now clears the outcome**, so a later save's "Saved …" message with
  its Undo can appear where before it stayed hidden — no test covers that case. And when the message
  closes, keyboard focus is not put back where it was. Next: a test for the first, and return focus
  to the field the save came from. Left open by A343 (#1368's review).
  [Detail](backlog/catalogue.md#closing-a-refusals-message-now-clears-the-outcome)

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version** —
  owner, 2026-10-07; PARKED, not queued — owner 2026-10-08: take it from here when a lane has room.
  Its work so far is on a LOCAL branch only — `feat/menu-preview-undo` at `e04b3abe7`, in the
  worktree `waitron-feat-menu-preview-undo` (no push, no pull request).
  [Detail](backlog/catalogue.md#a353--previews-changes-an-undo-link-that-puts-one-change-back-to-the-live-version)

- **An imported bundle may carry priced menu rows for a product no menu reaches, and adding the
  product back to a menu revives those prices** (found in A347's review, believed to predate it).
  Options: run `syncMenuOffers` over every menu after an import, or refuse priced rows no menu
  reaches. Left open by A347 (#1392); A435-1 (2026-10-09) replaces the former Disable action with Archive.

- **A bulk Disable of 500 products could not read the count in A347's review** (HTTP 431, because
  the ids go in the URL), so the dialog says "every menu"; the smallest count that fails was not
  measured. Left open by A347 (#1392). A435-1 (2026-10-09) renames the action Archive; the request still carries ids in the URL.
  The earlier 500-product failure has not been remeasured.

- **Deleting a category with its contents says its products come off every menu, with no count.**
  Left open by A347 (#1392).

- **At a 320px window only "12.50 – 15.00" was measured** in a menu's Price overrides tab. Left
  open by A346 + A348 (a price this menu sets stands out, an Available column, and Edit product,
  #1408).

- **`MenuPriceRow.active` and `MenuPriceVariant.active` are always true since A347 (#1392)**, so the
  dashboard's Inactive branches cannot be reached. Retiring them deletes the tests whose subject is
  an Inactive row, so it waits for the owner. Left open by A346 + A348 (#1408).
  [Detail](backlog/catalogue.md#menupricerowactive-and-menupricevariantactive-are-always-true-since-a347-1392)

- **In the real dashboard at a 390px window the table is 358px wide** (read once in the dashboard's
  test browser; no test pins it). Whether one-word names keep their line there while no field shows
  a range has not been measured. Options for more room: less page padding on phones, or a shorter
  Actions heading. Left open by A346 + A348 (#1408).
  [Detail](backlog/catalogue.md#in-the-real-dashboard-at-a-390px-window-the-table-is-358px-wide)

- **On the Structure tab at 390px the tree's own box scrolls sideways under the pinned ⋮**, by
  design (`pinned: "end"`); in Spanish Disponible now sits wholly behind it until the tree is
  scrolled. Letting long names wrap at narrow widths may free the room; not tried. Left open by A346
  + A348 (#1408).
  [Detail](backlog/catalogue.md#on-the-structure-tab-at-390px-the-trees-own-box-scrolls-sideways-under-the-pinned-)

- **The reveal fix corrects only a row left under the headings.** A row revealed at the bottom edge
  is not corrected, and by the same whole-pixel rounding it can sit up to half a pixel past the
  bottom (left alone; not measured). Left open by A294 (the Products and Structure trees show drag
  grips only in a mode, #1300).

- **The database still accepts a maximum of 0** — OPEN, unqueued: the owner has not asked for it;
  left open by A263 (#1151). The CHECK on `extra_lists` allows `max_picks = 0` when `min_picks` is
  0, and configuration transfer copies stored lists without the request check, so a stored 0 can
  still arrive; the form then shows the 0 and refuses to save until it is changed. Refusing it in
  the database is a table rebuild (CLAUDE.md §3's rebuild rule).
  [Detail](backlog/catalogue.md#what-1151-left-open-2026-10-03)

- **A very long number is cut off in the narrower box** — OPEN, unqueued; left open by A263
  (#1151). The request check accepts up to 2147483647, which needs about 82px against the 66px
  between the buttons (measured by #1151's review); three digits need about 26px. Left alone
  because widening the box would undo the size the owner approved.
  [Detail](backlog/catalogue.md#what-1151-left-open-2026-10-03)

- **At 390px the extras table's Price column runs past its scroll area's right edge until
  scrolled** — OPEN, unqueued; left open by A263 (#1151). W49 changed the table's column sizing,
  but horizontal scrolling remains for the Price column at phone width. (2026-10-04: W75 added a
  Portion column and widened the table; not re-measured.)
  [Detail](backlog/catalogue.md#what-1151-left-open-2026-10-03)

- **The options LIST form's names section is left as it is** — left open by A199 (done by A170,
  #1040). Read as the single option's form, which the screenshots show; the options LIST form's
  section is left as it is — ask if both were meant.

- **In the product editor's Descriptors fold at 390 a long English description fills both of its
  lines** — looked at 2026-10-03, after A200 (#1076): so the Spanish one does not show at all on
  the closed line.

- **Open test gap from A201b** (#1091): removing `#closeLostList()` from `#includeMenu` in a
  disposable checkout left `pnpm --filter @waitron/dashboard exec vitest run
  src/screens/menus-screen.test.ts` green (207/207, 2026-10-03). The suite does not establish
  whether that guard catches a list disappearing between the last read and selection. Check that
  race with a focused test, or remove the guard if the path cannot occur; its reachability remains
  unverified.

- **Past sales of a variant that had a category of its own now show under its product's
  category** — left open by A209 (#1090): in the category sales report's "Current categories"
  mode (`current`, `packages/reporting/src/category-sales.ts`), which classifies each line by the
  catalogue as it is today; "Categories at time of sale" still reads what each line recorded.

- **A configuration import copies `products` rows as they are** — left open by A209 (#1090):
  (`select *` in `apps/server/src/configuration-transfer.ts`, from `CORE_CONFIGURATION_TRANSFER`
  in `packages/db/src/configuration-transfer.ts`), so an imported variant can arrive with a stored
  category that the effective category and the editor's read then ignore.

- **The same "nothing" still reads two ways in one window** — left open by A211 (#1096): the
  course dropdown says "— none —", and on a variant's page the hints under the open Nutritional
  info say "None" (`editor.allergens_none`, `editor.diet_none`) where the closed line says "None
  specified". At 390 wide a two-field line can wrap inside a value ("Dietary preferences: None" /
  "specified"). Whether the Pricing fold should also name an empty base price or VAT is a question
  for the owner.

- **A disabled course keeps its name** — left open by A212 (#1087), raised in its review and not
  changed there: because `kitchen_courses_name_key` covers disabled rows too, so adding a course
  with a disabled course's name is refused as taken; a deleted course frees its name (read, not
  run). [Detail](backlog/catalogue.md#a-disabled-course-keeps-its-name)

- **The catalogue-screen test "ignores the closed window's late close…" catches its guard's
  removal only through an unhandled error** — left open by A212 (#1087): because the late close
  throws before it changes anything a state assertion could see.
  [Detail](backlog/catalogue.md#a-disabled-course-keeps-its-name)

- **On a variant's page an empty line reads "None specified" while the grey hint under it gives
  the parent's values** — left open by A213 (#1079), raised in its review: which reads as a
  contradiction — A211's "an empty value shows the parent's value" is the natural place to settle
  it.
  [Detail](backlog/catalogue.md#allergens-and-dietary-preferences-are-edited-in-place-a213-what-1079-left-open)

- **On a product's own page a reviewed-empty allergen list and one nobody has reviewed yet
  (`allergens: null`) both read "None specified"** — left open by A213 (#1079), raised in its
  review. The variant hint already tells the two apart ("Not yet reviewed",
  `editor.allergens_unreviewed`); the product line does not.
  [Detail](backlog/catalogue.md#allergens-and-dietary-preferences-are-edited-in-place-a213-what-1079-left-open)

- **Each list still reads "Extra bread · Extras", and under its heading the " · Extras" is now
  said twice** — left open by A218 (#1082).

- **With three lists the dropdown already scrolls, so "+ New options list…" sits at or just below
  its bottom edge when it opens** — left open by A218 (#1082).

- **In Spanish the folded line reads "IVA: Reduced (10%)"** — left open by A219 (#1065). The VAT
  class name is the stored label, which `taxLabel` shows untranslated, and on `main` before #1065
  the VAT dropdown already read it the same way. Where those labels come from, and whether they
  should be translated, is not checked.

- **Left open by #1188's review, none started** — the pricing unit dialog (W66, #1188): (1) one
  kind of unit refusal reads "The server rejected this value…", and on the price field after a
  price message "this value" reads as the price — a unit-specific sentence needs the owner's
  wording; (2) the price field's own unit button does not announce that it opens a dialog
  (`aria-haspopup`), while the heading's button does — needs an option on the shared
  `wt-price-input`; (3) `EACH_CHOICE` is still exported from `variant-table.ts` though only the
  product editor uses it; (4) the test title "…when the table's heading dropdown is hidden" still
  says dropdown for what is now a button; (5) the product editor's VAT dropdown is not disabled
  while saving (same on `main` before W66, not checked further).
  [Detail](backlog/catalogue.md#left-open-by-1188s-review-none-started-the-pricing-unit-dialog-w66)

- **In the wide Extras editor at 1280px wide, the items table scrolls sideways by 4px** — left open
  by W70 (#1222): (978px of content in a 974px box), with or without the size attribute.

- **At phone width the "All products" default colour cannot be set** — left open by A332 (#1430):
  at phone width every swatch slot is hidden except a category's name box while it is being named,
  and a category's row menu has no colour item, so the default cannot be set on a phone (owner
  2026-10-08: leave it until categories get a phone-width way in).

- **A refused default colour reuses `category.invalid {field:"color"}`, as the VAT default reuses
  `product.invalid`** — left open by A332 (#1430).

- **While a category is being added or renamed, its name box square shows only a colour chosen
  for it** — left open by A423 (#1443): so an inheriting category's square turns into an empty
  outline while its name is typed — left as built, the owner may ask for the inherited colour
  there too.

- **The product editor's image picker can still be opened while the editor's own save is being sent**
  (found by #1446's Codex review, which held the save request open and clicked the image chooser) —
  not queued. Left open by A427 (#1446), under A331 batch 2a.

- **Left as built, for the owner: Save turns active only for a refusal the window holds when it
  OPENS** — one handed to it while it is already open leaves Save as it was (believed unreachable,
  from reading only: the list's own Save sits behind the open window) — and it stays active for the
  whole time that window is open, even once the refused field is edited back. Left open by A410
  (an options list's refused option opens its window with Save active, #1434), under A331 batch 2a.

- **An edit typed BEFORE one of these forms is taken out of the page and put back stays on screen
  but no longer counts as unsaved** — DONE for the unit form in A397 part 2 (#1439). Still untried:
  the "VAT class for new products" default, the ingredient form, the options list and its option
  window, the extras list, Add to menus, Add products, Schedule and Change time. It matters only if a
  screen ever moves an open form. Left open by A331 batch 2a (#1422).

- **A menu published before this keeps a variant's own unit, frozen in its published copy, until the
  menu is next published** — left open by A222 (#1101) (`applyLiveFields`,
  `packages/catalogue/src/menu-document.ts`, serves that copy; read, not run).

- **A configuration import still copies `product_units` rows as they are** — left open by A222
  (#1101) (`packages/catalogue/src/configuration-transfer.ts`), so an imported variant can arrive
  with a unit row, which those reads then ignore.

- **At 390px the items table is wider than its scrolling box with or without the mark** — left open
  by A223 (#1098, an extras list's product dropdown greys a product with variants), seen, not
  changed (scroll width 496 in a 356 box), and the mark wraps in the narrow product column, so a
  marked row is about twice as tall as its neighbours.

- **At 390px the extras list form's item table runs past the dialog's edge, its headings cut
  ("Preselecc…")** — left open by A178g (#1021), seen in its LOOK, not changed and not checked
  against `main` before it (screenshots kept outside the repository).

- **From #541's review, neither blocking:** the product list shows a variant's blank price as its
  parent's with no marking (`apps/dashboard/src/widgets/product-list.ts`) — whether to grey it is
  the owner's call. [Detail](backlog/catalogue.md#from-541s-review-neither-blocking)

- **Review suggestions on the product editor not taken (Task 6):** split the editor's types into a
  product shape and a variant shape, derive `InheritedValues` from the product type, and write a
  parent's variant republishes in one statement. Nothing waits on them.

- **The product list.** It leaves a variant's allergen cell empty (`ListedVariant`,
  `packages/catalogue/src/product-types.ts`) — decide whether it should read a variant's effective
  allergens. [Detail](backlog/catalogue.md#the-product-list)

- **A variant image usage's `productId` has no reader in the dashboard**
  (`packages/media/src/dashboard/client.ts`). **Next action:** drop the field, or say what it is
  kept for.

- **The extras form cannot pick a variant**, though the catalogue accepts one as an extras item
  (owner decision 2026-09-24): its picker lists top-level products only (`listProducts`). **Next
  action:** decide whether the picker should list variants.

- **A configuration transfer copies `extra_list_items` as a table**, so it does not ask
  `extras.product_has_variants`; a venue holding data written before #578 would carry such an item
  across. Read, not run; nothing unless transfers from older venues matter.

- **A location's menu list is read by no sale.** **Next action:** owner to decide whether to retire
  `location_catalogues` and those routes with `GET /api/products`.
  [Detail](backlog/catalogue.md#a-locations-menu-list-is-read-by-no-sale)

- **Two signals say whether a dish is sold by weight, and they can disagree in storage.** Since B4
  the order path reads only the unit (`priceOrderLines`), so no sale reads `products.pricing_unit`.
  **Next action:** keep it in step with the unit or drop it.
  [Detail](backlog/catalogue.md#two-signals-say-whether-a-dish-is-sold-by-weight-and-they-can-disagree-in-storage)

- **`createProduct` and `updateProduct` duplicate the legacy-`pricingUnit` fallback**, and the
  synthetic `EACH_UNIT` id is a literal in both `packages/catalogue/src/unit-validation.ts` and the
  till's `product-name.ts` with nothing pinning them equal.
  [Detail](backlog/catalogue.md#createproduct-and-updateproduct-duplicate-the-legacy-pricingunit-fallback)

- **The combined end-to-end journey has not been walked**: creating a unit, a category and the
  extras and options a product carries from inside a dirty product draft, through the actual routes
  against a real database, and taking the result through the till. **Next action:** walk it once on
  a dev stack.

- **The catalogue picker was deleted and nothing replaced it.** `selectedCatalogueId`
  (`catalogue-screen.ts`) takes the first catalogue in the list, which is also the one every new
  product is created in; with two, the second becomes unreachable from the dashboard. **Next
  action:** decide whether more than one catalogue is a case Waitron supports.

- **A product's name can be stored blank.** `products.name` is `NOT NULL` with no non-empty check,
  and only the editor's parser refuses a blank; `option_lists.name`, `option_labels.name` and
  `extra_lists.name` share the pattern (`packages/catalogue/drizzle/0000_baseline.sql`). **Next
  action:** decide whether the columns want a check constraint and the write paths a domain refusal.

- **A refused customer name cannot say which value it refused.** `content.translation_required`
  carries only the language, so the editor resolves the field from the body it submitted — exact for
  one missing value, the first of several otherwise. An owner call if it ever bites.

- **Smaller things #379 surfaced and did not take.** The kitchen screens show a kitchen-resolved
  dish name above modifier text resolved in the device's own locale. A joined customer-facing line
  can mix languages when a locale exists on one half only.
  [Detail](backlog/catalogue.md#smaller-things-379-surfaced-and-did-not-take)

- **Pass 2 — icons — is not started.** Pass 1 renders allergens and diets as text pills; pass 2
  replaces them with Material Design icons across the dashboard, waiter basket and kitchen/expo
  screens. **Next action:** write the pass-2 spec when the icon work is picked up.

- **"May contain" survives in the data with no way to see or set it.** **Next action:** decide
  whether "may contain" stays a real product claim — if it does, the picker needs a control for it;
  if not, the field and its readers go.
  [Detail](backlog/catalogue.md#may-contain-survives-in-the-data-with-no-way-to-see-or-set-it)

- **The product editor summarises the same values twice.** **Next action:** whoever adopts the
  shared picker for ingredients and the till picks ONE shape, and decides whether the product editor
  keeps both summaries.
  [Detail](backlog/catalogue.md#the-product-editor-summarises-the-same-values-twice)

- **The picker collapses on `focusout` alone** (`#finishEditing`). If the editor is reported
  snapping shut mid-selection, make the collapse depend on `relatedTarget`.

### Service periods, opening hours and departments

_Formerly entries spread across the old sections, A261's venue-operations steps among them; part of A9._ Detail: [backlog/service-periods.md](backlog/service-periods.md).

- **Enabling a zone or a department leaves what disabling switched off as it is** — found along the
  way by W110e (#1290), each left as it is: a department's zones stay disabled, a zone's tables stay
  disabled, and its routing exceptions and watcher zones stay gone (a profile's starting zone is
  kept since W97, 2026-10-06: `readProfileZones` falls back to the profile's first usable zone while
  it is disabled).

- **Departments and menus** (#297) remaining: remove the legacy price and fixed-station compatibility
  fields; per-menu modifier authoring; workforce assignments; immutable department attribution and
  reporting; batched readiness and offer queries; a replication smoke test. Same legal seller is the
  working assumption, to confirm before go-live. Hours moved to A254.

- **Service times, departments, zones and prep stations (A366, owner 2026-10-07) — SPEC
  APPROVED 2026-10-07; remaining work is slices 4–7.**
  Station-hours and fallback retirement, period routing, combined tickets, monitors, department
  pages and department receipts remain in slices 4–7. Slice 7's plan/spec apply the owner's
  2026-10-08 receipt answers; its build follows slice 6 Part A (two PRs; Part B needs slice 6).
  [Detail](backlog/service-periods.md#service-times-departments-zones-and-prep-stations-a366-owner-2026-10-07--spec-approved-2026-10-07)

- **Opening hours dated-save refusal presentation** — reproduce a general refusal beside multiple
  own-hours dates and keep it beside only the action that failed, retaining its retry and draft.
  [Detail](backlog/service-periods.md#opening-hours-dated-save-refusal-presentation)
- **Opening hours real-week headings** — remove the repeated weekday while keeping the date and
  Today marker readable in EN/ES, both themes, at 1280 and 390.
  [Detail](backlog/service-periods.md#opening-hours-real-week-headings)

- **Sending grace after a period extension is replaced or expires** — decide whether a positive
  end offset survives a later period's extension or the business-day changeover; two real-store
  probes observed it ending with the replaced/expired row. The current one-row/today-only rule is
  approved slice 3 decision 4. [Detail](backlog/service-periods.md#sending-grace-when-a-period-extension-is-replaced-or-expires)
- **Who authorised today's station or period change** — A366 slice 3 decision 14 leaves
  the authorising person's identity unstored. Decide whether to retain that identity before
  adding a history view. [Detail](backlog/service-periods.md#who-authorised-todays-station-or-period-change)

- **Changing the business-day start after saving service hours** — open review follow-up from
  A366-1. Reproduce through the real settings route before choosing a fix; the reviewer changed
  the setting directly in the database. [Detail](backlog/service-periods.md#changing-the-business-day-start-after-saving-service-hours)

- **Departments, service styles and opening hours (A254, owner 2026-10-03) — DRAFT SPEC, partly
  implemented through A261.** The first department is named after the venue; the
  four-value service style splits into separate settings, and a tab no longer needs a table; hours
  come from venue-wide day types plus a calendar; a per-department switch prints the trading name.
  [Spec](superpowers/specs/2026-10-03-departments-service-styles-hours-design.md); §6 lists what is
  open, including advisor questions Q21, Q14, Q27 and Q22. [Detail](backlog/service-periods.md#departments-service-styles-and-opening-hours-a254-owner-2026-10-03--draft-spec-partly-implemented-through-a261)

- **The "Disabled" note a zone or department can show is not muted** — left open for the owner by
  A301 (#1335, A261 step 2). A zone with no department shows its "Not configured" note apart from
  its name, in the muted text colour. Left open for the owner: the "Disabled" note a zone or
  department can show in the same place is not muted (it was not before A301 either), so the two
  notes now look different.

- **A rename refusal without a supplied name remains a database error, rather than returning an
  undefined name** — left open by A261-2d (#1274).

- **The Hours page fixes its read window (yesterday plus a year) when it opens** — left open by the
  reviews of A261 step 5 (Hours, #1298): a page left open for days keeps the old window until it is
  reopened.

- **For a non-default station with no hours, Hours says "No hours restriction" and Prep stations
  says "Always open" (owner informed)** — left open by the reviews of A261 step 5 (Hours, #1298).

- **Smaller notes from the Hours reviews** — left open by the reviews of A261 step 5 (Hours, #1298):
  the calendar's day read repeats the subject precedence `resolveSubjects` holds and matches a cell
  by id alone; one `hours-client.test.ts` case detaches in the same turn and cannot fail; …
  [Detail](backlog/service-periods.md#smaller-notes-from-the-hours-reviews)

- **2027 data** — left open by A261 step 6 (Public holidays, #1305). Not shipped; the BOE daily
  summaries to 2026-10-06 held no 2027 national list. Follow the yearly update once it is published
  ([public-holidays.md](developers/public-holidays.md)). Andalucía's own 2027 calendar (BOJA,
  Decreto 84/2026) is not national coverage and is not shipped.

- **Canary islands** — left open by A261 step 6 (Public holidays, #1305). The island choice is built
  from the data, but setup refuses the Canary provinces, so no venue reaches it.

- **Province edits in Venue details** — left open by A261 step 6 (Public holidays, #1305).
  `apps/server/src/venue-details.ts` still refuses every province change (`geography_context` before
  sales). Allowing it is a separate decision; nothing in step 6 changes it.
  [Detail](backlog/service-periods.md#province-edits-in-venue-details)

- **Smaller notes from the public holidays reviews** — left open by A261 step 6 (Public holidays,
  #1305): there is no control to clear a chosen area back to "not chosen" (the route accepts it);
  the area names "Arán" and "Lleida, fuera del territorio de Arán" are Spanish data labels shown
  untranslated in English; …
  [Detail](backlog/service-periods.md#smaller-notes-from-the-public-holidays-reviews)


### The kitchen and preparation

_Formerly the kitchen entries in the opening part of the old Track A (before A1), and kitchen entries elsewhere; part of A9._ Detail: [backlog/kitchen.md](backlog/kitchen.md).

- **The dashboard's read-only Prep stations screen still shows only its Stations tab, so a view-only
  manager does not see the watcher list there** — left open by W110b (#1278) and A285 (#1308): `GET /management-api/watchers`
  now needs only `venue.view`, like the stations and courses lists (writes still need
  `venue.configure`).

- **`#fallbackReason` (`packages/venue-service/src/dashboard/prep-stations-screen.ts`) turns the
  server's `switched_off` reason into `prep.test_disabled` for both of its callers, and the review
  found no test for the caller that explains an extra falling back to another station** — a test
  gap, reported by W110's review (#1255) and not re-checked. W110c's review read #1269 as having
  added a test for it; not re-checked, so this entry may be stale.

- KDS-4 follow-ups: device-mode reprint behind `requireDevice`; the mirrored station-side read (a
  `DashboardApi.listStationPrinters` and a UI line); the reprint timestamp.

- **KDS operations — low priority (A9)** — Gaps: a routing read-back / audit view (the station
  selects are set-only — the most useful to close); no station `type`/`kind`; single-target only (no
  fan-out, no per-modifier or per-time rules). Table and service statuses have full CRUD; kitchen
  statuses are partial — `bump_mode` and `fire_control` are configurable fixed enums, but a
  user-definable kitchen-status list does not exist.
  [Detail](backlog/kitchen.md#kds-operations--low-priority-a9)

- A party finished while its food is still on the pass keeps its cards there with no group button
  that works (each is refused `party.not_open`); a question for the owner. Left open by service Task
  5 (#750, kitchen, pass and table screen by group; printing problems).

- `*** REPRINT ***`, `GROUP n`, `*** HOLD ***`, `*** FIRE ***`, `*** HOLD CHANGED ***` and `*** HOLD
  CANCELLED ***` print in English. Left open by service Task 5 (#750).
  [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)

- A switched-off printer's printing problem keeps showing until the printer is switched on and a
  Reprint prints there; there is no way to dismiss one. Left open by service Task 5 (#750).

- A failed ticket on a pass printer (one ticket for the whole order) shows on the card of every
  station it covered, even where that station's own printer printed; it stops showing at a station
  once a Reprint of the bill would not link that pass printer to that station. _2026-10-01 (slice
  3d): the whole-order printer is gone; a watcher's copy is linked to no station and shows no
  printing problem (W23)._ Left open by service Task 5 (#750).
  [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)

- Finish table drops the problem of a bill that transfers emptied (read, not run; not re-checked by
  B6a). Left open by service Task 5 (#750).

- After a merge, a reprint of the absorbed bill that was still waiting at the merge clears nothing
  when it prints, so its warning stays until the merged bill is reprinted once more
  (`moveKitchenPrintLinks`, `apps/server/src/kitchen-print.ts`). Left open by service Task 5 (#750).
  [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)

- Only dishes whose unit does not print on the ticket — sold in Each by the unit's identity
  (`readLinesSoldInEach`), or with no unit recorded on the line — are added together or split; a
  venue-made unit that counts pieces (a "portion"), even one spelled like Each, prints line by line,
  because nothing records a unit's kind (a unit field would need a migration). Left open by service
  Task 5 (#750).

- The kitchen-ticket grouping setting sits on Venue settings' **Kitchen** tab, and so does "Print
  held groups in advance", which is not about sent work at all. Left open by service Task 5 (#750).

- `fireHeldGroupsOfCourse` (`apps/server/src/order-groups.ts`), through which a course Fire still
  fires a party's held groups, is to be removed in a follow-up. Left open by service Task 5 (#750).

- Setting up a venue from an imported configuration deletes every kitchen station, and the
  `kitchen_print_jobs` station key has no delete rule; whether that venue can already hold link rows
  at that point was not tested (read, not run). Left open by service Task 5 (#750).

- The pass's Ready and Away record no `order_group_events` row, so who pressed them is recorded
  nowhere readable; a new kind changes that append-only table's check, which is a core migration.
  Left open by service Task 5 (#750).

- Questions for the owner: the kitchen and pass screens offer Fire on every held group, where the
  plan's text said "the first held group"; and the table screen reads its printing problems in a
  second request beside the groups read on every table load (folding them in would change the
  exact-body assertion in `apps/server/src/till-api.groups.test.ts`). Left open by service Task 5
  (#750).

- A failed HOLD correction slip (HOLD CHANGED or HOLD CANCELLED) raises no "Printing problem", like
  every correction slip: none is recorded in `kitchen_print_jobs`. Left open by service Task 6
  (#761, HOLD tickets in advance).

- A printed HOLD ticket goes stale when held groups are reordered or a party is merged into another
  (both renumber `GROUP n`), and when the party's table moves or is joined, since no MOVED slip goes
  out for held work (`readSentWork`, `apps/server/src/kitchen-print.ts`). Only a FIRE ticket or a
  Reprint can be relied on. Left open by service Task 6 (#761, HOLD tickets in advance).
  [Detail](backlog/kitchen.md#task-6-761-hold-tickets-in-advance)

- Whether a group's HOLD ticket was queued is recorded per group, not per station, so a correction,
  and a Reprint's REPRINT and HOLD section, can print at a station whose printer never printed that
  group's HOLD ticket. Left open by service Task 6 (#761, HOLD tickets in advance).

- **A plan default the owner may overturn (P16):** spec §15's "leaves with them outside any group"
  is read as the side the bill leaves; the receiving party groups the dishes. Left open by the table
  actions plan's Task 9 (#874, dishes arriving in a party get a kitchen group).

- Left by C78's review: the earliest fire time is picked by comparing the stored times as text,
  right only while every writer stores the same `toISOString()` form (every writer found uses
  `nowIso()`; not proven for all); and a dish recalled and fired again carries its new fire time but
  its old group's firer. Left open by the table actions plan's Task 9 (#874, dishes arriving in a
  party get a kitchen group).

- Left by C80 (read from `draftSections` and `groupArrivingDishes`, not compared with a running
  till): the till files a dish whose course it does not list (an inactive course) under the earliest
  course it lists, while a move keeps it in its own held group; and when a round is SENT,
  `working-order.ts` picks its earliest course without checking whether it is active, so with a
  switched-off course the send path and the move path can file a dish with no course under different
  courses (owner, 2026-09-29: not queued). Left open by the table actions plan's Task 9 (#874,
  dishes arriving in a party get a kitchen group).

- **Is a `+` sub-line enough for a doneness answer on the kitchen ticket?** **Open, and worth a
  cook's eye before a real service:** whether that is enough for something a cook must not miss, or
  whether an options answer deserves its own prominent form on the ticket.
  [Detail](backlog/kitchen.md#is-a--sub-line-enough-for-a-doneness-answer-on-the-kitchen-ticket)

- **Prep stations review notes retained for future cleanup** — left open by A261 step 3 (#1269): the
  overview API object still exposes write methods (server routes remain the permission boundary),
  and station reordering repeats an active filter after an active-only read.

- **On the Routing tab, the label above the "Where is this made?" time choice is cut** — seen in
  A323's look at the demo (2026-10-07), in files A323 did not change; left open by A261-4 (#1363).
  The label is cut to "W…" ("Cuá…" in Spanish) at 1280 and 390 px, in both themes, because the
  choice is too narrow for it. At 390 px the Prep stations tab row scrolls sideways with both ends
  cut ("Stations" on the left, "New watcher" on the right) and nothing shows that it scrolls.
  [Detail](backlog/kitchen.md#on-the-routing-tab-the-label-above-the-where-is-this-made-time-choice-is-cut)

- **At 390 px the routing grid's fixed first column takes about 140 of the grid's roughly 310 px** —
  seen in A372's look at the demo (2026-10-07), in files A372 did not change; left open by A261-4
  (#1363). One zone column shows at a time and a saved choice in a zone column is reached only by
  scrolling sideways.
  [Detail](backlog/kitchen.md#at-390-px-the-routing-grids-fixed-first-column-takes-about-140-of-the-grids-roughly-310-px)

- **Prep stations' Settings cell saves have the shape A261-4 changed for routing cells** — left open
  by A261-4 (#1363). `#saveSettingsCell`
  (`packages/venue-service/src/dashboard/prep-stations-screen.ts`) marks the change saved and
  releases its unsaved-changes registration as soon as the save succeeds, before the refresh that
  follows has settled.
  [Detail](backlog/kitchen.md#prep-stations-settings-cell-saves-have-the-shape-a261-4-changed-for-routing-cells)

- **A routing choice a refresh drops names one reason, chosen when it is dropped** — left open by
  A375 (#1382, its review, 2026-10-07): if its zone and its category both go and only the zone comes
  back, the message still names the zone; and only a returning zone or product has a test that the
  message clears — a returning category or No category row has none.

- **Counter/walk-up kitchen fire** — the #193 follow-up, the next piece of menu work.

- **KDS corrections deferred from #191** — owner, 2026-09-01. A moved dish must keep its kitchen
  status — the ticket must travel with the line, not re-fire. Then the low-priority KDS list under
  [KDS operations](backlog/kitchen.md#kds-operations--low-priority-a9).
  [Detail](backlog/kitchen.md#kds-corrections-deferred-from-191)

- **Order-timing and modifier follow-ons**: delivery-order floor flash, idle-floor escalation,
  station-kind threshold defaults, an unbumped-since-fire metric; on-screen modifier `×N`, the shared
  `#allergens` render, the KDS-versus-till unreviewed-dish call, post-fire note edit
  (needs a re-fire endpoint), the TS-4 partial-transfer modifier-split guard.

- **Mark a new dish as urgent** — owner, 2026-09-27. A waiter can already send a new dish straight
  to the kitchen ("cook this now, don't hold it") under every release setting; the owner would like
  a way to add urgency to it too, so the kitchen sees it flagged. Nothing like it exists today.
  [Detail](backlog/kitchen.md#mark-a-new-dish-as-urgent)

- **Avoid repeat watcher configuration reads during a table move — OPEN (3d).** — left open by the
  product folders work. `readSentWork`, `enqueueMovedSlips`, and `printCorrectionSlips` each read
  watcher printers in the move flow. Measure the query count on a moved order with a watcher
  printer, then pass one read through the transaction if it repeats unchanged configuration.

- **Show one watcher in a canvas card — OPEN (3d, P15).** — left open by the product folders work.
  The ordinary embedded pass card still shows All stations; a watcher-bound device opens its own
  board.

- **Alert when a watcher's screens go dark — OPEN (3d, P17).** — left open by the product folders
  work. The existing dark-screen alert is station scoped, while a watcher can follow several
  stations.

- **Move an enrolled kitchen screen between stations and watchers without joining again — OPEN (3d,
  P18).** — left open by the product folders work. Its binding is selected at joining; changing that
  binding needs a separate action.

- **Keep watcher Done marks through a `ticket_items` rebuild — OPEN (3d).** — left open by the
  product folders work. `watcher_item_marks` cascades from `ticket_items`, so a rebuild empties
  those marks.

- **Keep the two watcher filtering rules together — OPEN (3d).** — left open by the product folders
  work. The server's `watcherSees` and Prep Stations' `watchersSeeing` each have a hand-copied test
  table. Neither test detects a change to the other rule.

- **Three follow-ups 3c-1 left:** — left open by the product folders work. the kitchen screen's
  column view has no per-order card, so it does not show the rest of the order…
  [Detail](backlog/kitchen.md#three-follow-ups-3c-1-left)

- **A till-session station view can bump a dish another station now has.** — left open by the
  product folders work. The till-session `POST /api/ticket-items/:id/advance` route does not check
  the item's station (`apps/server/src/till-api.ts`); the device route does
  (`apps/server/src/device-api.ts`) and refuses `device.forbidden_station`.
  [Detail](backlog/kitchen.md#a-till-session-station-view-can-bump-a-dish-another-station-now-has)

- **A following extra has different names on paper and on screen.** — left open by the product
  folders work. Decide which name the following extra should show, then make the surfaces agree.
  [Detail](backlog/kitchen.md#a-following-extra-has-different-names-on-paper-and-on-screen)

- **The dark-screen alert can be wrong** (S2b, owner, 2026-10-01). A kitchen working from paper may
  never mark dishes ready on its screen. Improve how the alert distinguishes a kitchen using paper
  and how the dev chooser records check-ins.
  [Detail](backlog/kitchen.md#the-dark-screen-alert-can-be-wrong)

- **Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it).** —
  left open by the menus plan. The counter's prep-queue card shows no notices and does not refresh.
  [Detail](backlog/kitchen.md#changing-sent-lines-and-the-kitchen-screen-task-7c-710-and-the-kitchen-fixes-after-it)

- **Each is decided by the unit's identity, with one known gap.** — left open by the menus plan.
  While a line is still open, deleting the stored unit seeded as `each` it was sold in makes its
  queue row, any notice recorded after, its printed ticket, the expo board and the ticket's
  merge-or-split check read it as not Each, because `readLinesSoldInEach` looks the seed key up on
  the live unit row…
  [Detail](backlog/kitchen.md#each-is-decided-by-the-units-identity-with-one-known-gap)

- **Whether a `+ <list>: <label>` sub-line is prominent enough on a kitchen ticket** to replace the
  old `** MEDIUM RARE **` framing has not been put to a real cook.

- **The review left detached `readOnly` changes and a retained table's scroll/sort unverified**; no
  defect was reproduced for either. Before changing screen caching, exercise those transitions. Left
  open by A331 batch 4d (preparation stations' Save state, #1426).

- **The Prep stations screen's two add buttons ("Nueva estación", "Nuevo punto de seguimiento")
  share the tab row's action area, which that screen caps at half the row**, so at phone width in
  Spanish the second button is cut and scrolls within its area. A424 (#1452) kept this screen's old
  layout rather than squeeze its tabs. A better home — one button per tab, or one Add menu — is the
  owner's call. Left open by A424.

### The till, devices and table service

- **Investigate a null device identity during profile switching.** A432’s full till coverage run
  on 2026-10-08 passed 5,951 tests and its thresholds, but the browser logged an unhandled
  rejection at `apps/till/src/till-app.ts:4468` through `#readIdentity` / `#enterSwitchedProfile`.
  Reproduce which profile-switch test answers null and determine whether the fixture or the
  public identity response needs correction; keep the existing profile and login assertions.
  Receipt: Lane D `receipts/a432/task5-ci-till-coverage-green.log`, PR #1463. Cause unverified.

_Formerly A4; part of A9._ Detail: [backlog/till.md](backlog/till.md).

- **The till's find-bill pay shows the generic sale error for an over-limit refusal**: the
  find-bill dialog (`apps/till/src/widgets/find-bill-dialog.ts`) takes its error as a plain
  string key, so it cannot carry the amount the collect and table-bill paths now show. Left open by A230 (`@waitron/verifactu` 0.2.1, #1099).

- **Split-off checks may reach the same path as a held-order edit that changes sent lines** — found
  by #623 while pruning comments. Nothing tests two `openTab` calls racing on one table or
  concurrent rounds landing on consecutive line numbers (the sequential versions are in
  `tabs.test.ts`).
  [Detail](backlog/till.md#split-off-checks-may-reach-the-same-path-as-a-held-order-edit-that-changes-sent-lines)

- **"resets any leftover drill/active tab on login" still passes with login's own clearing line
  deleted** — found by #621 while pruning comments. A question the prune moved here from a deleted
  `menu-filter.ts` comment: should the `no-meat`/`no-fish` lenses also hide a dish whose diet is
  still pending review, as `vegan`/`vegetarian` do?
  [Detail](backlog/till.md#resets-any-leftover-drillactive-tab-on-login-still-passes-with-logins-own-clearing-line-deleted)

- **Test titles repeat claims the branch corrected** — found by #618 while pruning comments
  (`apps/till` `src/api` + `src/state` + `src/i18n`).
  [Detail](backlog/till.md#test-titles-repeat-claims-the-branch-corrected-618)

- **Test titles repeat claims the branch corrected** — found by #616 while pruning comments
  (`apps/till/src/widgets`). A courseless section the server held shows its lines greyed with no
  fire button (`#fireAction` in `station-queue.ts`, from #131). `GET /api/till` never sends
  `stripe_on_device`, so the offline-consent toggle cannot appear.
  [Detail](backlog/till.md#test-titles-repeat-claims-the-branch-corrected-616)

- **The till always mounts the counter screen `embedded`** — found by #614 while pruning comments.
  In device mode the station screen's `#reload` swallows a `device.unauthorized`, so a device cookie
  revoked mid-session raises nothing until the next connect.
  [Detail](backlog/till.md#the-till-always-mounts-the-counter-screen-embedded)

- **Two `v8 ignore start` comments in `till-sale.ts` (`finalizeCapture`, `finalizeSettle`) cite
  `provider.ts:66-83`** — found by #613 while pruning comments. The checker compares tool comments
  character for character, so repointing them to `PaymentResult` in
  `packages/payments/src/provider.ts` is not a comments-only change.
  [Detail](backlog/till.md#two-v8-ignore-start-comments-in-till-salets-finalizecapture-finalizesettle-cite-providerts66-83)

- **A table with no shape is drawn as a rectangle and saved as round on its first edit** — found by
  #604 while pruning comments. `wt-table-token.ts` draws `shape-${t.shape ?? "rect"}`, while
  `wt-floor-canvas.ts` marks Round as pressed and sends `shape: t.shape ?? "round"` from
  `#placementOf`, so dragging, nudging or rotating a shapeless table changes it (read from the code,
  not run).
  [Detail](backlog/till.md#a-table-with-no-shape-is-drawn-as-a-rectangle-and-saved-as-round-on-its-first-edit)

- **Seating a booking at a table in a zone that is not a table-tab zone has no bookings test** —
  found by #574 while pruning comments (`packages/bookings`). The server accepts an empty contact
  name; only the dashboard form refuses one.
  [Detail](backlog/till.md#seating-a-booking-at-a-table-in-a-zone-that-is-not-a-table-tab-zone-has-no-bookings-test)

- **The bookings seat picker keeps a table it no longer offers** — OPEN (found 2026-09-23, writing
  bookings' coverage tests, PR #503). A throwaway browser test armed the picker on `t-1`, then let a
  live refresh empty the table list: the dropdown showed no options and the value `""`, and
  confirming still called `seatBooking("bk-1", { tableId: "t-1" })`. **Next action:** decide what
  the picker does when its tables change under it (re-pick the first, or close) and fix it
  test-first. [Detail](backlog/till.md#the-bookings-seat-picker-keeps-a-table-it-no-longer-offers)

- **Five till handlers still leave a failed list refresh unhandled, and one a11y file may not render
  its screen** — OPEN (found 2026-09-25, review of PR #641). **Next action:** decide whether
  discard, advance and mark-collected go through `#refreshAfterWrite` with their own "X succeeded,
  but…" strings, and what login and retrieve show when their refresh fails. Give both a11y cases'
  `getTill` a canvas and assert `till-counter-screen` exists before each scan.
  [Detail](backlog/till.md#five-till-handlers-still-leave-a-failed-list-refresh-unhandled-and-one-a11y-file-may-not-render-its-screen)

- **Another till lookup reads inherited object properties** — OPEN (found by W24's review,
  2026-10-03, by reading, not run). `allergenName` looks a string key up in a plain object, so a
  key such as `constructor` finds an inherited property — the defect `deviceKindLabel` had. **Next
  action:** look `allergenName`'s key up on own properties only (`Object.hasOwn`, as
  `apps/till/src/i18n/codes.ts` does), with a test.
  [Detail](backlog/till.md#another-till-lookup-reads-inherited-object-properties)

- **The till's idle-timer check may be unreachable — OPEN (found by W24's review, 2026-10-03, by
  reading, not run).** `session-activity.ts`'s `#shouldRunIdleTimer` keeps the `this.#active &&` check
  that `#shouldHoldWakeLock` lost, and its callers look the same. **Next action:** remove the check
  with a receipt, as W24 did for `#shouldHoldWakeLock`, or keep it by decision.

- **Cash handed back for a voided cash sale is recorded nowhere** — OPEN (found 2026-09-24 by #605).
  A void writes no payment or refund row, so if staff give a customer cash back, the void's day
  shows a drawer shortfall at cash-up. **Owner decision 2026-09-25:** keep it here and decide it
  when the till's void screen is designed.
  [Detail](backlog/till.md#cash-handed-back-for-a-voided-cash-sale-is-recorded-nowhere)

- The dev `?dev` chooser shows `label · kind` rather than `name · profile`; the Spanish
  form-factor label differs between two pickers ("TPV" vs "Caja registradora") — an owner copy call.

- Recorded, not blocking: a handheld's Order tab is tappable with no active table; the
  boot-into-floor prefetch is unreached by any shipped canvas; the station screen's device-mode enrol
  sub-view is unreachable; the default counter canvas has no prep-queue rail.

- **A re-sent "place" on an already-placed order answers 409 rather than replaying the original
  result — leave it, or build the replay?** — a product decision to take before production. Leaving
  it is a real option — the 409 is a defensible state conflict and the till keeps the basket and
  shows `place.error`. The gain if built is that a re-tap after a lost response returns the invoice
  already issued instead of an error.
  [Detail](backlog/till.md#a-re-sent-place-on-an-already-placed-order-answers-409-rather-than-replaying-the-original-result--leave-it-or-build-the-replay)

- **Till UX for the timed-out card case** — retry, alternative tender, or wait. [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

- **`apps/till/src/till-app.ts` decides permanent-refusal / known-code / unknown at five call sites;
  a helper would collapse it.** Cosmetic, and cheapest alongside the tip-collection work that touches
  `#onPayTab`. Raised by the A1 review wave (A1d).

- **The till's top bar: because items leave strictly in that order, a wide item can take narrower
  ones with it** — open, for the owner; left open by A395 (#1435). Option: after the bar fits, bring
  back any item that left earlier and now fits, so the order is no longer strict. Not done.
  [Detail](backlog/till.md#the-tills-top-bar-is-one-row-at-every-width-a395-1435-left-open)

- **The till's top bar: a change in the pending-transfer count alone never brings items back onto
  the bar**, so when the count shrinks or goes away, items can stay in More although they would now
  fit, until the next resize or other change refits the bar. Open, decided as built; left open by
  A395 (#1435).

- **Three lines in `apps/till/src/widgets/tab-shell.ts` are pinned by no test** (deleting any one
  leaves every test passing): the phone-width early return in `#release`, the return after re-adding
  a step in `#fit`, and the unobserve of a replaced language chooser. Left open by A395 (#1435).

- **Remaining till unit and tab edges, OPEN, unqueued (A379/A385 run-it review).** A unit with no
  enabled text has an empty label; the tile and basket-refresh price templates still append a slash.
  Render those empty-label cases before choosing their display.
  [Detail](backlog/till.md#remaining-till-unit-and-tab-edges-open-unqueued-a379a385-run-it-review)

- **A292's look is the owner's to judge** (#1310's "Looks for the owner to judge"; screenshots in
  lane C's `a292-shots/`): in the dark theme an available plain tile is only about 1.10:1 lighter
  than a sold-out one, and in the light theme a pale stripe shows mostly through the dark line
  beside it.

- **On the till, opening a section from lower on the screen leaves the page scrolled**, so the
  breadcrumb is out of view. I believe this predates W93: neither `main`'s nor W93's
  `apps/till/src/widgets/menu-browser.ts` scrolls on opening a section (read, not bisected). Left
  open by W93 (#1287).

- **The native dialog's accessible name is tested, but actual screen-reader speech is unverified.**
  Left open by A413 (#1436, the Devices screen and Add a device).

- **Unassigned Profile cells stay blank; the None profile filter selects them.** No cell-wording
  change was queued. Left open by A413 (#1436, the Devices screen and Add a device).

- **A429 — floor plans: a master plan per zone, today's plan on the till (owner, 2026-10-08; spec
  approved; plan written; being queued).** A Square-style editor on the dashboard for each zone's
  master plan (tables created in bulk, saved joins, Undo/Redo), and a till map whose job is status
  and rearranging.
  [Detail](backlog/till.md#a429--floor-plans-a-master-plan-per-zone-todays-plan-on-the-till)

- **A414 — device screens on a phone (owner, 2026-10-08; open; campaign lane A, after A366-1
  lands).** [Detail](backlog/till.md#a414--device-screens-on-a-phone)

- **A436 — a kitchen display with someone signed in, logged out only after a long idle time** (owner,
  2026-10-08, answering the A366 slice 5 plan; open). The owner: "kitchen
  displays can have a login, but i would not expect them to log off automatically, or at least
  only after an extended logout time (eg 30 minutes)". Today nobody can sign in on one. Left out
  of slice 5 as too large for it.
  [Detail](backlog/till.md#a436--a-kitchen-display-with-someone-signed-in-logged-out-only-after-a-long-idle-time)

- `service_commands` rows are never pruned. Left open by service Task 2 (#715, a record per seated
  party).

- The venue setting `clearing_workflow` is off by default and no dashboard control sets it yet. Left
  open by service Task 2 (#715).

- Left open from the PR: a cross-party merge can leave a settled check's lines naming a group now on
  the target party; the deleted `moveTabLines` ignored groups, and whether the paths that move lines
  now do the same is not checked; a whole-order save replacing a held dish with another variant
  moves it to a new held group at the end; the counter's whole-order save does not answer the
  party's revision; and the table screen offers no Send on a held no-route dish outside any group
  (its per-line Send needs a kitchen ticket item, `sendsAlone`,
  `apps/till/src/state/held-groups.ts`) — whether one can occur on a party's tab is not established.
  Left open by service Task 3 (#733, order groups).

- **Fire all now / Fire selected now are offered under every `fire_control` setting** (the plan's
  test text wanted them hidden under `kitchen`/`expo`); a one-line gate in `#draftBar` if the owner
  wants it. Left open by service Task 4 (#748, the table screen works with order groups).

- Group summaries come from the server, so a weighed quantity shows a dot decimal in Spanish (a
  summary shows only when Current orders cannot be read). Left open by service Task 4 (#748).

- Group numbers are the server's positions, so the list can read "Group 1, Group 3"; the preview
  gives counts, not contents. Left open by service Task 4 (#748).

- The screen's older small buttons are 32 px tall, under the 44 px tap target. Left open by service
  Task 4 (#748).

- Per-line Send and Change have no guard against a second press while the first is running (Cancel
  has one since B11a; the group commands have one). Left open by service Task 4 (#748).

- **Splitting a held line's quantity on the till takes one request per unit.** A refusal part-way
  leaves the units already split. **Next action:** a server command that splits a line into single
  units in one transaction. Left open by the service, ordering and billing plan.
  [Detail](backlog/till.md#splitting-a-held-lines-quantity-on-the-till-takes-one-request-per-unit)

- "Ready" and "Fired N min ago" on the table screen are the plan's default, not an owner decision.
  Left open by service Task 5 (#750, kitchen, pass and table screen by group).

- A fired group with nothing for the kitchen (bottled water, say) never reads Ready. Left open by
  service Task 5 (#750).

- Every pass press moves the party's revision, so a waiter's open Tab drawer meets
  `party.out_of_date` after it and reads again. Left open by service Task 5 (#750).

- A draft that moves to the other party in a merge, because its owner had none there, records no
  history event: the event kinds have no "moved". Left open by service Task 7 (#789, each person's
  draft kept on the server).

- The server's own `unavailable` flag (`apps/server/src/order-drafts.ts`) does not flag a line whose
  options list is unanswered (refused at submission `options.label_required`), a fractional quantity
  of a dish sold whole (`quantity.invalid`), a course switched off since the save
  (`course.not_found`), or a menu version no longer live (`menu.version_changed`). Left open by
  service Task 7 (#789). [Detail](backlog/till.md#task-7-789-each-persons-draft-kept-on-the-server)

- Only the draft routes fold the ids in the path to lower case (`requireDraftPartyParam`,
  `apps/server/src/till-api.ts`, and `submitDraft`'s `joinGroupId`); the other party routes only
  check that the id is an id, and the group submission passes `joinGroupId` on as sent. Left open by
  service Task 7 (#789).

- After a takeover into the taker's existing draft, or a merge that discards a draft, the previous
  owner's next save of the old draft is answered `draft.not_found`, not `draft.taken_over`. Left
  open by service Task 7 (#789).

- A save must carry `draftId` and `revision` even for a new draft. A chosen option whose label id is
  not a UUID is refused `options.invalid` at save, where pricing answers `options.label_required`.
  Left open by service Task 7 (#789).
  [Detail](backlog/till.md#task-7-789-each-persons-draft-kept-on-the-server)

- Three rulings made on the branch for the owner to confirm: a line whose quantity is not a whole
  number never adds into another line; Finish table discards the party's open drafts, keeping their
  lines, instead of refusing while one is open; taking over someone's draft when you already have
  one adds their lines to yours and discards theirs, instead of refusing. Left open by service Task
  7 (#789).

- An edit can be lost at sign-out without a message: one made after the session had already ended
  (an inactivity sign-out), and one made while an earlier save was still waiting for its answer when
  sign-out began. Left open by service Task 8 (#806, the till works from the server's drafts),
  saving and sending.

- If someone else signs in while a sign-out is still waiting for its save, the till skips signing
  the first person out on the server, so that session lasts until it expires. Left open by service
  Task 8 (#806), saving and sending.

- A send cut off by the 150-second limit is not sent again, and after a reply that never came the
  draft can stay locked for up to two limits: the send, then the re-read. Left open by service Task
  8 (#806), saving and sending.

- When a send is refused because the menu changed, the re-read of the table's menu runs outside that
  limit. Left open by service Task 8 (#806), saving and sending.
  [Detail](backlog/till.md#task-8-806-the-till-works-from-the-servers-drafts)

- After a draft refusal whose re-read also fails, the till keeps the draft's old revision, so the
  next Send is refused as out of date and re-reads first: a wasted round trip. Left open by service
  Task 8 (#806), saving and sending.

- While the till follows a party onto its next bill, the screen can show no draft for a moment; and
  when a merge or move coincides with a refused save, the save's message can replace "another device
  changed this table". Left open by service Task 8 (#806), saving and sending.

- Drafts are not pushed to other tills: Sam's till sees Alex's latest draft only at its next read.
  Taking over an older copy is refused and the table read again. Left open by service Task 8 (#806),
  saving and sending.

- When the take-over added Alex's lines into Sam's own draft, Alex sees "Sam has an unsent order",
  not "Taken over by Sam": `takenOverFrom` on Sam's draft is empty. Left open by service Task 8
  (#806), other people's drafts.

- At phone width nothing on the menu view says other people have drafts on the table; the button
  reads "Review (0)". The floor's mark does say so. Left open by service Task 8 (#806), other
  people's drafts.

- Three automatic changes to the draft (`adoptLines`, `removeLines` and `clear` on the till's store)
  are not blocked while a take-over is out. Read in the code, not run. Left open by service Task 8
  (#806), other people's drafts.

- The Spanish "has taken over this order" wording has no test. Left open by service Task 8 (#806),
  other people's drafts.

- The map tag says "Unsent" but not whose. Left open by service Task 8 (#806), the floor.

- At 390 px the map overlaps and clips crowded tables, so a table's tag can hide under a neighbour.
  Left open by service Task 8 (#806), the floor.

- **A token near the plan's top edge is cut off by that edge**. The owner chose on 2026-09-29 to
  land #891 with the chip inside the token and fix this later. **Next action:** decide whether the
  map keeps a token inside the plan, or the chip hangs off the token's edge like "Unsent". Left open
  by service Task 8 (#806), the floor.
  [Detail](backlog/till.md#task-8-806-the-till-works-from-the-servers-drafts)

- The map gives its "forgotten table" corner marker no spoken name. Left open by service Task 8
  (#806), the floor.

- Seating a table whose answer arrives while a newer table is still opening shows the seated table
  briefly before the newer one replaces it. Left open by service Task 8 (#806), the table screen.

- A refused seat leaves the till pointing at the refused table. Left open by service Task 8 (#806),
  the table screen.

- If the screen widens while Back on the Review view has focus, focus goes to the page. Left open by
  service Task 8 (#806), the table screen.

- A dish no longer on the menu shows an empty name on its tick button in the person's own draft, and
  in the spoken names of its course picker and Split quantity button (read in the code, not run).
  Left open by service Task 8 (#806), the table screen.

- The last-added bar is empty for a draft read back from the server until the next tap, and does not
  follow a weighed line when the server's answer replaces the lines. Left open by service Task 8
  (#806), the table screen.

- While a weight is being entered, the weight entry covers the bottom of the menu and the bar. Left
  open by service Task 8 (#806), the table screen.

- "Review (N)" counts items (Beer ×2 counts 2), while the floor's mark counts lines and calls them
  "items", so the two can differ for one draft. Left open by service Task 8 (#806), the table
  screen.

- Keep lasts only until the server's answer rebuilds the lines; a kept line then asks Remove or Keep
  again. Left open by service Task 8 (#806), the table screen.

- A dish no longer on the menu, saved at a whole quantity, counts by that quantity on Review; its
  unit is unknown, so a weighed one saved at exactly 2 kg counts 2. Left open by service Task 8
  (#806), the table screen.

- The counter's basket also tracks its last-added line, which it does not use. Left open by service
  Task 8 (#806), the table screen.

- The server's "cannot be sold" mark is dropped once the till's newer menu read passes the line.
  That the two checks agree was read, not run; if they differ, one Send is refused
  `product.unavailable` and the line is marked again, which a test covers. Left open by service Task
  8 (#806), menu changes.

- Every line priced under an older menu version is asked about whenever the server's draft replaces
  the till's lines (a reload, a re-read, a take-over), so the question comes more often than it
  would for a person who watched the menu change. Left open by service Task 8 (#806), menu changes.

- A line naming a version the till does not hold costs one more read of the table's menu. Left open
  by service Task 8 (#806), menu changes.

- The "The menu has changed" dialog shows a focus ring round the whole dialog box. Left open by
  service Task 8 (#806), menu changes.

- Tests: the accessibility test "has no violations with the round grid, the per-line course picker
  and the open tab drawer" no longer scans the menu grid (a phone test does), but kept its name.
  Left open by service Task 8 (#806), tests.
  [Detail](backlog/till.md#task-8-806-the-till-works-from-the-servers-drafts)

- **Rulings made on the branch for the owner to confirm** — left open by service Task 8 (#806, the
  till works from the server's drafts).
  [Detail](backlog/till.md#task-8-806-the-till-works-from-the-servers-drafts)

- A line outside any group that needs no kitchen, held, and first released after its bill was paid
  could not be marked served (`group.line_held`), because `stampSent` wrote `sent_at` only on an
  open bill. Since B21 (#969, core `0053`) `stampSent` writes on any bill but an abandoned one;
  whether this case is now served was not measured. Left open by service Task 9 (#814, served by
  quantity, release reminders, Current orders).

- The floor's older waiting band (`timingBand`, which colours the card and shows "Forgotten") still
  counts HELD dishes, while the long-wait chip counts only dishes sent to the kitchen. So a table
  whose only work is a held course queued long ago shows "Forgotten" with no wait chip. **Next
  action:** decide whether `timingBand` should also count only dishes sent. Left open by service
  Task 10 (#908, the service dashboard's attention signals). For the owner.

- The "Take order" chip has the same primary border on a neutral fill as the "Reserved" badge, and
  the "Bill requested" chip is filled primary like the "N en camino" badge, so each pair looks
  alike. **Next action:** decide whether the chips get tones of their own. Left open by service Task
  10 (#908). For the owner.

- At 390 px the map's tokens carry chips and overlap more: see "A token near the plan's top edge is
  cut off by that edge", above. Left open by service Task 10 (#908).

- The till drops the bill request's late answer, a refusal included, once the waiter has signed out
  or left the party (`#onRequestBill`, `apps/till/src/till-app.ts`), stricter than most of C81's
  table actions. **Next action:** decide whether a late refusal should be said. Left open by service
  Task 10 (#908). For the owner.

- **The adjustment history records who approved, but not whether the bill's discount limit, rather
  than the reason, is why.** Recording it would need a column. **Next action:** decide whether to
  record it. Left open by service Task 11 (#916, cancellations, comps and discounts; B11a–B11g).

- **A placed pay-later counter order (`ticket_then_pay` or `invoice_first`) cannot be adjusted:**
  the placed-order trigger freezes its prices, and an `invoice_first` order has already filed its
  invoice. **Next action:** decide whether a placed order can be adjusted before it is collected.
  Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **The server's held-order edit (`PUT /api/working-orders/:id`) still voids a sent dish's dropped
  quantity without a reason** when a client sends it that way, the venue allows changes to sent
  items and the kitchen has not started the dish (`applyLineEdits`,
  `apps/server/src/working-order.ts`). **Next action:** decide whether the edit should refuse
  dropping a sent line. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **Two basket changes the app makes by itself do not check the edit lock:** the menu poll's
  price-version update of the basket's lines (`adoptLines`) and the order's label
  (`WorkingOrderStore`, `apps/till/src/state/working-order.ts`). **Next action:** decide whether the
  two should wait for the lock. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **Nothing on screen shows the lock.** A tap on `+` or on the menu does nothing until the order and
  its lines have been read. How long it lasts on a real network is not measured. **Next action:**
  dim the basket, or show a one-line note, while `editsLocked` is set. Left open by service Task 11
  (#916).

- **A reason's percentage limit can be exceeded** by combining a bill discount with a line discount,
  or two bill discounts under one reason, because a bill discount counts as 0% on each line. **Next
  action:** decide whether the per-line cap should see bill discounts. Left open by service Task 11
  (#916). [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- For an extra of a held dish whose HOLD ticket was queued, cancelling it tells the kitchen (B11g)
  but the till's cancel dialog still says only that it comes off the bill, because the till cannot
  see whether the HOLD ticket was queued. **Next action:** decide whether the till should be told
  that. Left open by service Task 11 (#916).

- An extra counts its dish's percentage under a reason's per-line cap, and a dish the largest of its
  extras', which errs toward refusing. **Next action:** none unless staff find it gets in the way.
  Left open by service Task 11 (#916).

- **Only give-aways and discounts split part of a dish with its extras.** Splitting a bill,
  transferring items and moving part of a dish to another group still refuse a partial move of a
  dish with extras (`tab.transfer_modifier_line`). A whole dish moves with its extras. **Next
  action:** decide whether those partial moves should split extras too. Left open by service Task 11
  (#916).

- The till's "Amount off (€)" writes the euro sign into the label rather than taking the venue's
  currency. How a comp or discount appears on the invoice is still asesor Q29. Left open by service
  Task 11 (#916).

- **A till request's `frozenExtras` and `frozenOptions` are taken as already settled, prices
  included** (found in #903's review; I believe it predates that branch). **Next action:** send such
  a line through `POST` park and the held-order edit route; if it is stored, re-price or refuse
  client-sent frozen selections at the route boundary.
  [Detail](backlog/till.md#a-till-requests-frozenextras-and-frozenoptions-are-taken-as-already-settled-prices-included)

- `apps/server/src/orders-list.ts` (#1027) sorts bill payments and their refunds by `created_at, id`
  and tenders by `id` alone; ids are `randomUUID()`, so a tie, and the tenders' whole order, comes
  out random. The plan asked for `created_at, rowid` in `readBillPayments`. **Next action:** a
  `rowid` tie-break, with a test whose ids sort against the writing order. Left open by service Task
  14 (#721, several payments against one bill, the server).

- **The kitchen queue's Collect sends no submission id**, on the station screen and on the counter's
  prep-queue card, so a Collect resent after a lost reply is refused
  `working_order.already_collected`. The waiting list's Hand over sends one. Left open by service
  Task 16 (#981, counter handover; with B25, B26, B29, B30).
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **A collect straight after Place order does not re-read the kitchen queue.** Left open by service
  Task 16 (#981). [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **The waiting list is drawn only inside the held-orders card**, so a canvas without that card
  shows no waiting list. Left open by service Task 16 (#981).

- **Not measured — Pay on a sent `invoice_first` order whose invoice was credited may show the wrong
  total in the basket.** Reported by B16's review fixer from reading; no test shows it. Left open by
  service Task 16 (#981).
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- Lane B item B31 (owner, 2026-10-02; #1018): at login each counter list shows its own failure with
  a retry notice, so one list that fails no longer stops the others loading (they are still read one
  after another, so a read that hangs still delays the rest); this changed for tills too. Left open
  by service Task 16 (#981).

- A till profile saved before C130, and one newly created on the Device profiles screen, has the
  three switches off until a manager turns them on; a till with no device reads no capabilities, so
  it shows none of the three buttons. Left open by C130 (#1056, a device shows the screens its
  profile assigns), under service Task 16 (#981).

- A change to a device profile reaches a till only when the till starts again — a page load, a move
  to another server or a re-enrolment, or in dev mode the lock screen's switch-device button (the
  profile is read in `#boot`, `apps/till/src/till-app.ts`, as the layout and the hardware switches
  already are), so signing out and in again does not pick it up. Left open by C130 (#1056, a device
  shows the screens its profile assigns), under service Task 16 (#981).
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- On the handheld, the station screen's back button says "Back to counter" though a handheld on the
  built-in phone layout lands on the floor plan. Left open by C130 (#1056, a device shows the
  screens its profile assigns), under service Task 16 (#981).

- A staff list longer than the screen still makes the page scroll to reach the language button
  (since A187, 2026-10-02, the language chooser is at the top right of the lock screen). Left open
  by C133 (#1045, the till's tabs fit one screen), under service Task 16 (#981).

- Left from C133's review, not changed there: the table-order screen's bottom bar still keeps a tap
  target and two gaps clear at its end (`padding-inline-end` on `.bottom-bar`,
  `apps/till/src/screens/till-table-order-screen.ts`) for a floating language button the till no
  longer has — the language button now sits in the tab shell's top bar (A187). Removing the space
  changes the screen's layout, so it is its own change. Left open by C133 (#1045, the till's tabs
  fit one screen), under service Task 16 (#981).
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- Likewise the till's `.submitted-toast` (`apps/till/src/till-app.ts`) still sits one tap target and
  two gaps above the bottom edge, the room the old bottom-right language button (later the footer)
  took; decide whether it should drop to the bottom edge. Left open by C133 (#1045, the till's tabs
  fit one screen), under service Task 16 (#981).

- **Collecting PART of the debt later is not built**, for the same reason. Collecting it in full
  uses `POST /api/working-orders/:id/collect`. Left open by service Task 17 (#991, a table that
  leaves without paying). [Detail](backlog/till.md#task-17-991-a-table-that-leaves-without-paying)

- **The table screen still reads a credited presented bill at its full amount.** Left open by
  service Task 17 (#991, a table that leaves without paying).
  [Detail](backlog/till.md#task-17-991-a-table-that-leaves-without-paying)

- **A bill presented without an invoice keeps the label it was placed with when the departure
  invoices it.** Fixing it needs that trigger to allow the label to change. Left open by service
  Task 17 (#991, a table that leaves without paying).
  [Detail](backlog/till.md#task-17-991-a-table-that-leaves-without-paying)

- **Gaps against the service plan's acceptance checks (spec §12)**, from a sweep on 2026-10-01: **No
  permanent test lays the service screens out at phone and till widths in both themes (§12 item
  14).** The axe scans run in both themes, mostly at the browser's default size with one block at
  390 px (`apps/till/src/screens/till-table-order-screen.a11y.test.ts`).

- **The approver list is fetched with no time limit.** The unpaid-departure and refund dialogs fetch
  theirs the same way and predate B32; a time limit belongs on all three together. Left open by C126
  (cancelling an order whose invoice was issued credits it, #1030) and B32 (#1055, the till offers
  "Cancel and credit").
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **The result does not name the credit note.** Naming it would need the number from somewhere new;
  not decided. Left open by C126 (cancelling an order whose invoice was issued credits it, #1030)
  and B34 (#1077, a counter order invoiced when it was placed can be cancelled with a credit note).
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **A cancel that gets no answer is never shown as done.** Left open by C126 (cancelling an order
  whose invoice was issued credits it, #1030) and B34 (#1077, a counter order invoiced when it was
  placed can be cancelled with a credit note).
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- Unlike the table's button, the counter's does not check for a payment on the order. If an order
  does hold one, the cancel refuses it with `bill.payments_received` and the dialog says so. Left
  open by C126 (cancelling an order whose invoice was issued credits it, #1030) and B34 (#1077, a
  counter order invoiced when it was placed can be cancelled with a credit note).
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- The move moves the bill's revision on, open or presented, without `bumpRevision`'s refusal of
  money in flight, since a move changes no amount (plan P19); plan P17 flags for the owner that a
  MOVED slip can name the same table as where the dish came from and where it went (the slip's text
  was not checked); and since A143 (#928) paying a pay-first order with a dish no station can take
  files the sale and raises `route.dish_not_sent`, but invoice-first placing still refuses such a
  dish — nobody has decided whether it should take the order and raise the alert instead. Left open
  by the table actions plan's Task 7 (#864, move a whole bill).

- A party with no table whose chain of merges never ends (an unknown id, or two parties recorded as
  merged into each other, which the database accepts) is named by the bill's own label; whether any
  till action can make such a loop was not checked. Left open by the table actions plan's Task 8
  (#869, move guests, join and split tables) and C77/C86.

- `party.main_bill_stays`'s till wording says "the table has other unpaid bills", which Split a
  table choosing the main bill need not satisfy. Left open by the table actions plan's Task 8 (#869,
  move guests, join and split tables) and C77/C86.

- Left by #906's review: `computeOverdueOrders` is the one report function that reads its own node's
  location rather than being handed one (adding `locationId` to `OverdueOrdersInput` was suggested,
  not done); no case pins what a MOVED slip's "from" line or a correction slip prints for a counter
  order delivered to a table; and a database built on purpose with a delivery table in another
  location now names the order by its own label — no product path creates that state, and whether
  every existing venue database is free of it was not checked. Left open by the table actions plan's
  Task 8 (#869, move guests, join and split tables) and C77/C86.

- Unchecked Send to radios are Chromium's own dark-theme control, dim grey on the dark dialog (seen
  in the 390 px Spanish dark screenshot). Left open by the table actions plan's Task 10 (#875).

- Open (found by #905's review, by reading, not reproduced): on a handheld, a waiter who taps a free
  table to seat it, goes back to the order tab while the seating is still under way and starts Move
  guests can have the move set the wrong table on the new party; the suggested fix is to count only
  table opens started in the current operator session; not queued. Left open by the table actions
  plan's Task 11 (#881).

- The till sends `otherPartyId: null` when its floor does not list the target table at all (a failed
  floor read empties the list); a table another party holds is then refused as out of date, never
  combined. Left open by the table actions plan's Task 11 (#881).

- On a 390 px phone the bill choice's buttons wrap ("Keep separate bills" on three lines). Left open
  by the table actions plan's Task 11 (#881).

- Seen by C82 at 390 and 1280 px, not measured further: a token for four seats or fewer, or with no
  seat count set, is so narrow that the party name shows only its first few letters ("T…" at two
  seats), and the table's label, its covers and its "to serve" chip spill past the token's edge; the
  map's token sizes (`sizeForCapacity`, `wt-floor-canvas`) decide that (owner, 2026-09-30, on C82's
  question: "wait on this"; not queued). A tab total does not fit either: see "A four-digit total
  does not fit a small round table on the till's floor map", below. Left open by the table actions
  plan's Task 11 (#881).

- **Open, from C84's review (#913):** when a void or line change gets no answer, `#rereadAmounts()`
  can put on screen what the party still owes, taken from its bills after its own floor read failed,
  while the revision on screen stays where it was. Traced in the code, not reproduced. Left open by
  the table actions plan.
  [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)

- **A four-digit total does not fit a small round table on the till's floor map** (found 2026-10-03
  by looking at the map while making its amounts follow the locale, lane C's W15). **Next action:**
  the owner decides whether this changes "wait on this"; a fix that lets a small token hold what it
  shows would cover both.
  [Detail](backlog/till.md#a-four-digit-total-does-not-fit-a-small-round-table-on-the-tills-floor-map)

- **Later: optional seat/guest item assignment (owner, 2026-09-20).** Include shared items when this
  is designed. For now, orders remain at table/tab level and staff select items manually when
  splitting bills; seat assignment is not a prerequisite for the service workflow.

- **Later: staff-to-table assignments (owner, 2026-09-20).** Design assigning responsibility for
  tables to staff, including handover and how assignments appear on the floor dashboard. The current
  workflow discussion assumes no assignments; they are not a prerequisite for the dashboard.

- **Later: change the working floor layout during service (owner, 2026-09-20) — covered by A429
  (2026-10-08), whose spec §6 is this item.**
  [Detail](backlog/till.md#later-change-the-working-floor-layout-during-service-owner-2026-09-20)

- **Four till surfaces ask for a caution colour that is defined nowhere, so all four render as plain
  text.** **Next action:** whoever takes the till layout pass below decides whether these four want
  `--wt-color-warning`, a new `--wt-color-warning-text` defined in both themes, or the
  `--wt-color-danger` the dish picker's refusals now use.
  [Detail](backlog/till.md#four-till-surfaces-ask-for-a-caution-colour-that-is-defined-nowhere-so-all-four-render-as-plain-text)

- **Five measured till layout defects and one seen in a screenshot, all of them older than the
  extras-and-options work.** Found while looking at the real screens for B1 Task 12.
  [Detail](backlog/till.md#five-measured-till-layout-defects-and-one-seen-in-a-screenshot-all-of-them-older-than-the-extras-and-options-work)

- **Unchecked since the service plan's Task 8 (#806): whether a round entered while the floor was
  being re-read is still hidden when the till follows the party onto its next tab**
  [Detail](backlog/till.md#unchecked-since-the-service-plans-task-8-806-whether-a-round-entered-while-the-floor-was-being-re-read-is-still-hidden-when-the-till-follows-the-party-onto-its-next-tab)

- **The till does not load its menu until a manual refresh**, and a dashboard menu change does not
  appear live on it. A till-app fix.

- **The three displays walked end to end** — [ui-review.md](ui-review.md)'s areas, at the real box.

- **Location-consistency guard** — nothing enforces that a sale-capable device's own location
  (`devices.location_id`) is the box's configured location. Guard at enrol or first sale.

- **Refuse a request from a device that is not enrolled** (owner design of 2026-08-30, deferred
  until after the demo:
  [design](superpowers/specs/2026-08-30-device-auth-enrolment-fail-closed-design.md)). But a request
  that carries NO device still passes `assertDeviceCapability`
  (`apps/server/src/device-session.ts`). It sits on the sale and cash path, so it takes the full
  review. [Detail](backlog/till.md#refuse-a-request-from-a-device-that-is-not-enrolled)

- **Screen faults seen during menus Task 9's look on 2026-09-27.** **Next action:** check each
  against `main`, then fix or file it on its own.
  [Detail](backlog/till.md#screen-faults-seen-during-menus-task-9s-look-on-2026-09-27)

- **Build good screens for each kind of device, and retire canvases (A182, owner 2026-10-01).**
  Nothing has carried that out. Every device's screen is still built from a CANVAS: a stored list of
  tabs, each tab a grid of cards, chosen per device profile. **Decided the same day: delete now**,
  before the redesign.
  [Detail](backlog/till.md#build-good-screens-for-each-kind-of-device-and-retire-canvases-a182-owner-2026-10-01)

- **What W105b left open (#1248, a disabled device coming back as itself)** — left open by A268
  (add a device, like adding a printer, owner 2026-10-04). (1) the slow hash check runs only when
  the cookie names a disabled device, so the response time hints that an id is a disabled device;
  asks are rate-limited and, outside dev mode, accepted only while Add a device is open.
  [Detail](backlog/till.md#what-w105b-left-open-1248-a-disabled-device-coming-back-as-itself)

- **What W106 left open (the battery on the Devices list, #1240)** — left open by A268. (a) the
  relative-time words (W106a, #1272, `wt-relative-time`) show the exact time in the BROWSER's time
  zone: the relative-time widget receives no venue time zone.
  [Detail](backlog/till.md#what-w106-left-open-the-battery-on-the-devices-list-1240)

- **What W105 left open (#1235)** — left open by A268. (5) the Devices table's Shows column reads
  "— no station —" for a screen on a switched-off station, because it looks the name up in the
  switched-on list; `binding.name` could fill it.
  [Detail](backlog/till.md#what-w105-left-open-1235)

- **What W104 left open (#1225)** — left open by A268, not acted on. (1) a Pair save that never
  answers locks both dialogs, because a save carries no time limit
  (`packages/dashboard-kit/src/request.ts` limits GETs only).
  [Detail](backlog/till.md#what-w104-left-open-1225)

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

- **Three refactors of sign-in-adjacent code, and renaming the `seedTill` test fixtures** —
  deferred in the PR of A238 (a till is a device, #1164).

- **Recorded cash in and out of a till's drawer (A239) — OPEN, needs a spec before queueing (owner,
  2026-10-03).** Each top-up or removal of cash from a till device's drawer is a recorded entry:
  who, how much, why, when (topping up change, paying a supplier, a waiter handing in float cash).
  The entries replace the two typed totals the daily close takes today (opening float and payouts,
  `packages/reporting/src/record-daily-close.ts`).
  [Detail](backlog/till.md#recorded-cash-in-and-out-of-a-tills-drawer-a239--open-needs-a-spec-before-queueing-owner-2026-10-03)

- **Waiter cash floats (A240) — OPEN, needs a spec before queueing (owner, 2026-10-03).** Piece 3 of
  A238. Open: where a float's opening cash comes from (a till's drawer, or brought in). Needs A238
  (landed as #1164) and A239.
  [Detail](backlog/till.md#waiter-cash-floats-a240--open-needs-a-spec-before-queueing-owner-2026-10-03)

- **The till's schedule screen does not follow the forms rule yet** — left open by C47
  (#838/#839/#840/#841). Other till surfaces were not checked against the rule either, and whether a
  number pad or a choice picker counts as a form under it is open.
  [Detail](backlog/till.md#the-tills-schedule-screen-does-not-follow-the-forms-rule-yet)

- **The till's schedule screen tells the person to try again and gives them no way to** (found
  2026-10-03 by review of lane C's W14; read, not run). **Next action:** add a retry button the way
  the dashboard does, and decide whether each failed list gets its own line.
  [Detail](backlog/till.md#the-tills-schedule-screen-tells-the-person-to-try-again-and-gives-them-no-way-to)

- **Two till controls put `aria-pressed` on a `wt-button`, which does not pass it to its inner
  button** (found 2026-10-03 in review of lane C's W23; read, not run). **Next action:** make them
  native buttons with `aria-pressed`, as the Tab drawer's transfer and split pickers and the draft
  line toggle are.
  [Detail](backlog/till.md#two-till-controls-put-aria-pressed-on-a-wt-button-which-does-not-pass-it-to-its-inner-button)

- **Three till loading lines may not be announced** (found 2026-10-03 in review of lane C's W23).
  The schedule screen (`apps/till/src/screens/till-schedule-screen.ts`, #1103), the lock screen and
  the device chooser each insert a `role="status"` element already holding the loading text and
  remove it when loading ends. **Next action:** decide whether to keep an empty status region on the
  page and fill it later, and test that sequence.
  [Detail](backlog/till.md#three-till-loading-lines-may-not-be-announced)

- **The counter till may start in a zone its service zone dropdown does not list** (found
  2026-09-14; read, not run). **Next action:** find whether a `table_tab` zone can be the counter
  default or a profile's starting zone; if it can, decide whether that is refused where it is set or
  handled by the till.
  [Detail](backlog/till.md#the-counter-till-may-start-in-a-zone-its-service-zone-dropdown-does-not-list)

- **The till's four choice dialogs (`apps/till/src/widgets/`) each carry their own radio-option
  styles, which could be one shared set** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.

- **`apps/server/src/tables.ts` still translates every unique refusal in `createTable`,
  `updateTable`, `createStatus` and `updateStatus` to a label collision** — left open by A261-2d
  (#1274), outside that zone item; a separate follow-up should identify each label key and force
  another-key clash.

- **Unresolved observation from W101 verification** — left open by W101 (#1351). Two full local
  `@waitron/till test:coverage` runs logged an unhandled rejection in `#holdIdentity` while
  `#switchProfile` was reading identity. The triggering test and cause are unverified; isolate the
  profile-switch case and its identity response before choosing a fix.
  [Detail](backlog/till.md#unresolved-observation-from-w101-verification)

- **A card payment stuck `attempting` holds its device's profile switch** until a manager resolves
  it on Payments. Left open by W97 (#1311). The till only says to switch once it finishes; point
  it at the Payments screen.
  [Detail](backlog/till.md#a-card-payment-stuck-attempting-holds-its-devices-profile-switch)

- **The till's Profile button shows whenever the device has more than one approved profile**, read
  at boot: neither approvals added later nor the signed-in person's admission hide or show it
  until the dialog reads `/api/device/me` again. Left open by W97 (#1311).
  [Detail](backlog/till.md#the-tills-profile-button-shows-whenever-the-device-has-more-than-one-approved-profile)

- **The profile editor reads people and the venue's departments and zones**, so it needs
  `person.manage` and `venue_service.manage` beside `layout.configure`; no role holds only the
  last today. Left open by W97 (#1311).
  [Detail](backlog/till.md#the-profile-editor-reads-people-and-the-venues-departments-and-zones)

- **`apps/dashboard/src/screens/device-profiles-screen.ts` is over 1,600 lines**; "Where it
  serves" and "Who can sign in" could become widgets of their own. Left open by W97 (#1311).

- **Owner questions, each with the default built (answer when convenient)** — left open by W100
  (#1332). Removed: staff can no longer switch a device's printing off. Not shown: whether
  equipment is disconnected.
  [Detail](backlog/till.md#owner-questions-each-with-the-default-built-answer-when-convenient)

- **If the till's last 15-second check said a reader was busy and that payment has since
  finished**, picking it skips "Take it?" and the server refuses it as held, so staff pick again.
  Left open by W100 (#1332), found by reading, not run.

- **If a profile switch succeeds but its reply is lost**, a check sent before the switch can
  briefly show the old profile's reader until the next check. Left open by W100 (#1332), found by
  reading, not run.

- **The till's equipment poll and menu poll are near copies and could share one class** (left out
  of #1332 as too large). Left open by W100 (#1332).

- **Table states and signals (A267)** — OPEN, needs a design session (owner, 2026-10-03). From
  A261 §10. [Detail](backlog/till.md#table-states-and-signals-a267)

- **Handheld shared-table updates** — still queued: automatic table-content refresh while two
  waiters work on the same table. W101 supplies transfer-specific updates. Spec the wider
  subscription model when it matters.

- **Device profile follow-ons**: the aggregated device-profile bundle (till, station, hardware, area,
  order routing, printer target on the profile); the visual theme editor. The canvas-editor
  follow-ons that stood here, and a canvas-driven table-order screen, gave way to A4's A182.

- **Bookings**, each greenfield: public/online/QR booking, availability, reminders, a CRM entity,
  recurring, a calendar grid, deposits.

- **Show how many dishes are being made on the table plan — OPEN (3d, W16).** — left open by the
  product folders work. The plan has no such count; adding one needs another value from
  `listTablesWithState`.

- **Refresh the floor without a staff action — OPEN (3d, W16).** — left open by the product folders
  work. `till-floor-screen.ts` reads on events handled by `till-app.ts`'s `floor-refresh`, not on a
  timer. Polling would read `listTablesWithState` every few seconds on every till; choose the
  interval and cost first.

- **The station dialog's own guard has no test** — left open by A438 (#1472).
  `till-station-choice-dialog` refuses to send a choice while busy, with no station chosen, or with
  the current station (`apps/till/src/widgets/station-choice-dialog.ts`); its tests still pass with
  that refusal removed, and the app's matching early return in `#onWaitingStationChosen` is
  unreachable through it. **Next action:** a dialog test for each of the three, proved by deletion.

- **Move to station on a counter order sent but not paid** — left open by A438 (#1472), which
  offers the move on the "Paid, not handed over" rows only. A "Sent, not paid" row has no move,
  and the basket it is paid from cannot list its dishes (`readTabLines` refuses a non-open order).
  **Next action:** ask the owner whether that row needs it.

- **Current orders hides kitchen progress for an extra made at another station** (P6). — left open
  by the product folders work. The till's Current orders read attaches extras under each dish but
  reads kitchen state only from the dish's record (`readCurrentOrders`,
  `apps/server/src/order-groups.ts`). Show the extra's own progress.

- **The till's menu reads (Task 7, #719).** — left open by the menus plan. The basket comparison
  does not notice a publish that adds a required options list to a dish in the basket, or lowers a
  list's picks limit, so the till takes the new version silently and the server then refuses
  `options.label_required` (or `extras.limit_exceeded`): staff see a refusal where the dialog should
  have asked. [Detail](backlog/till.md#the-tills-menu-reads-task-7-719)

- **Every remembered round is marked again against the open table's menu**, so opening a table in
  another service zone can mark another table's round wrongly or clear its mark. Remember each
  round's zone, or keep rounds on the app, one per order.
  [Detail](backlog/till.md#every-remembered-round-is-marked-again-against-the-open-tables-menu)

- **The till's home page (Task 9, #729).** — left open by the menus plan. Search matches the staff
  name only, not a customer name or a section's name.
  [Detail](backlog/till.md#the-tills-home-page-task-9-729)

- **The till says "Not found" (menus spec §9) only when a newly read version drops the section it
  has open.** A shortcut whose target a newly read version lacks simply disappears, with no notice.
  **Next action:** the owner confirms this meets §9, or asks for a notice when a shortcut
  disappears.
  [Detail](backlog/till.md#the-till-says-not-found-menus-spec-9-only-when-a-newly-read-version-drops-the-section-it-has-open)

- **One stale-answer window remains OPEN** — left open by #912's review (secret checks and the write
  lock): the two join-status readers answer from a hash read just before the key is derived, so a
  request denied or revoked in that window can get one stale `pending` or `approved`.
  [Detail](backlog/dashboard.md#secret-checks-and-the-write-lock-the-pin-manager-login-and-profile-checks-moved--done-w1-1117-two-blocking-derivations-and-one-stale-answer-window-remain-open)

- **A joined tab of no party can have kitchen slips naming a table its ticket did not print.**
  Correction and MOVED slips name such a tab's lowest-id table (`orderTableLabels`,
  `packages/db/src/party-table-labels.ts`), so after a join a MOVED slip's "from" can name the other
  table; recording each ticket's printed table would fix it.
  [Detail](backlog/till.md#a-joined-tab-of-no-party-can-have-kitchen-slips-naming-a-table-its-ticket-did-not-print)

- **The owner decided a split check gets no Void; the server now allows one.** **Next action:** the
  owner decides whether that still covers the no-Void decision.
  [Detail](backlog/till.md#the-owner-decided-a-split-check-gets-no-void-the-server-now-allows-one)

- **A custom-unit extra still shows a dot in Spanish, and its kitchen unit can use the English
  abbreviation** (observed during A333, 2026-10-08). On the real Spanish-seeded till, the salad
  picker reads `1.00 rac`; its queued receipt reads `1.000 rac`, and its queued kitchen ticket
  reads `1.000 srv`.
  [Detail](backlog/till.md#a-custom-unit-extra-still-shows-a-dot-in-spanish-and-its-kitchen-unit-can-use-the-english-abbreviation)

- **`line-extras-editor.ts` holds the per-line kitchen note**, which was never part of this
  feature; the file name is misleading.

- **A retrieved line's options answers are re-sent by matching their WORDING**
  (`deriveOptionSelections`, `apps/till/src/state/held-options.ts`); a staff-name rename or a
  withdrawn label matches nothing, and the till surfaces `held.options_changed`.

- **A child extras row renders FLAT in the tab drawer**, beside the dishes, where the basket and
  the settled ticket nest it under its dish; whether the drawer should indent it is undecided.

- **Reopening the picker on a line whose dish has VARIANTS _and_ at least one offered list loses
  the variant, and says it saved.** Needs a decision first about whether a basket edit may change a
  variant AT ALL: if no, stop offering the variant control on a reopened line; if yes,
  `setLineModifiers` has to carry the product.
  [Detail](backlog/till.md#reopening-the-picker-on-a-line-whose-dish-has-variants-_and_-at-least-one-offered-list-loses-the-variant-and-says-it-saved)

- **Both of the modifier picker's LIST inputs carry a generated id as their `name`**
  (`extras-${list.id}`, `options-${list.id}`, `apps/till/src/widgets/modifier-picker.ts`), against
  `docs/developers/conventions-ui.md` and CLAUDE.md §3. The offered-list wire carries no stable
  per-list identifier to use instead, so closing this means adding one to that wire.

- **The live till basket still uses `×N` for modifier counts** (`apps/till/src/widgets/basket.ts`)
  — left open by W53 (#1152); W53 changes the filed display surfaces.

- **Synthetic phone captures also showed a clipped Counter total and padded-looking Spanish
  quantities** — left open by W69 (#1325). Cause and real-venue reproduction remain unverified.
  Inspect the real till before attributing them to W69 or changing quantity/money handling.

- **The two till buttons are A417 (lane A)** — other buttons that are not saves still kept their
  colour while disabled and waiting — … and two on the till. Owner, 2026-10-08: "b", draw them all
  quiet the same way. Left open by A416 (#1440), under A331 batch 2a.

- **The canvas Create and Duplicate dialogs have no Cancel, and Duplicate's name field is too narrow
  to show "A331 look canvas (copy)" whole** — seen and not changed. Left open by A331 batch 3b
  (#1415).

- **The station dialog widens or narrows with the chosen station's name, so its buttons shift a
  little as a station is picked** (it did so before this batch). Left open by A331 batch 5 (#1414).

- **A separate finding remains: entering `05,50` for an amount discount and pressing Continue raises
  `shared.invalid_decimal` from the existing amount check** (found during W69). W69 leaves the amount
  validation and request conversion unchanged.
  [Detail](backlog/till.md#a-separate-finding-remains-entering-0550-for-an-amount-discount-and-pressing-continue-raises-sharedinvalid_decimal-from-the-existing-amount-check)

- **Reopening a held order still removes a sold-out extra on the first edit.** The till now keeps
  such a line marked "Not offered now"; a line with no stored snapshot whose product the till no
  longer offers is still dropped with `held.product_gone`, and the first edit of the order removes
  such an extra.
  [Detail](backlog/till.md#reopening-a-held-order-still-removes-a-sold-out-extra-on-the-first-edit)

- **No kept test pins the refusal of a raise for an Unavailable size or an inactive menu** — left
  open by "Raising a held line's quantity checks the line's variant and its menu" (#696). Since W90
  a menu has no switch of its own to check.

- **A held order brought back to the till shows a variant line with its PARENT's VAT class,
  category and allergens**, read from the offer snapshot in `working_line_contexts`. Filing is
  unaffected. **Next action:** save or read the chosen variant's values for a retrieved line.

- **Retrieving a held order reads the counter's CURRENT zone offer, not the zone the order was
  parked in** (`#onRetrieveOrder`, `apps/till/src/till-app.ts`; `HeldOrder` carries no zone), so it
  can mark lines "Not offered now" when their own zone still offers them. Traced, not run. **Next
  action:** send the order's zone with the retrieved order and read that zone's offer.

- **A label typed when re-holding an unedited retrieved order is never saved**, because re-holding
  saves only through `#syncIfDirty` (`apps/till/src/till-app.ts`), and a label change does not count
  as a line edit. **Next action:** a way to save a label without re-sending the lines.

- **`GET /api/products` has no caller in the till app, and `listAvailableProducts` is off the sale
  path.** `TillApi.listProducts` (`apps/till/src/api/client.ts`) is kept because the till's tests
  stub it; outside tests `listAvailableProducts` is called by that route and two dev scripts. **Next
  action:** decide whether to retire the route and move the till's tests onto zone-offer fixtures.

- **A table in no zone still opens a tab, and nothing can be added to it** (`seatTable`, and
  `seatBooking` in `packages/bookings/src/bookings.ts`); every round is refused
  `order.service_context_missing` (pinned in `apps/server/src/till-api.zone-required.test.ts`).
  **Next action:** owner to decide whether to refuse opening a tab on a table in no zone, or to
  require every table to have a zone.

- **Two branches still read a held line that names no menu offer**, which only an order parked
  before B4 should have: `getHeldOrder` (`apps/server/src/working-order.ts`) and the till's retrieve
  (`liveByProduct` in `#onRetrieveOrder`). **Next action:** delete both, since no
  backwards-compatibility code is owed before production (CLAUDE.md §3), or say what keeps them.

- **The basket's "not fully reviewed" allergen warning depends on whether an option was picked**
  (`#allergenRow`, `apps/till/src/widgets/basket.ts`), a leftover of the old dish-and-extras fold.
  **Next action (owner decision):** whether an unreviewed dish shows that warning always, then make
  `#allergenRow` depend on the review state alone and update the test.

### Printers, the print agent and receipts

_Formerly A3, A8 and B6; part of A9._ Detail: [backlog/printers.md](backlog/printers.md).

- **What the AppArmor profile (A129, #862; A134, #887) left open:** **`trust` is still refused.** **The setup page's HTML says nothing about Bluetooth availability** — only `/status.json` and the log do. [Detail](backlog/printers.md#what-the-apparmor-profile-a129-862-a134-887-left-open)

- **The office-printer check and the check of addresses typed into the dashboard still run inside the poll** — left open by C117 (#955), so the job pull still waits for them (see "A sweep in flight keeps connecting" below). The agent puts no limit of its own on a scan pass; read, not run: the whole sweep across several networks and the USB reads have no overall limit.

- **Unpair can come back for a short while after a successful unpairing** — found in C103's review, read, not run. Clearing `pairedAt` when the agent reports a successful unpair, or reports the device unpaired, would end it; the owner was asked (questions.md, C103). [Detail](backlog/printers.md#unpair-can-come-back-for-a-short-while-after-a-successful-unpairing)

- **An agent compares the server's discovery deadline with its own clock** — found in C102, read, not run. An agent on another machine whose clock is out by minutes scans for the wrong span; one on the box shares its clock. [Detail](backlog/printers.md#an-agent-compares-the-servers-discovery-deadline-with-its-own-clock)

- **A sweep in flight keeps connecting after the discovery window closes** (189 of 253 connects on
  #313 started after expiry). Pass the deadline through `Host.scan`. The office-printer paper-size
  queries that follow the scan have no deadline either: at most eight at a time, each up to
  1.5 seconds, and the job pull waits for them, so printing is delayed while they run.

- Retry spacing is the agent's batch interval rather than a per-job backoff, so a flapping printer
  burns `MAX_DELIVERY_ATTEMPTS` at loop speed — needs a next-attempt column.

- **Cross-box print-agent TLS** — an agent trusts only its local box CA, so a mirror's agent cannot
  reach the primary; gates the mirror's print agent (_Afterwards_). The vouch slots into the same
  route later.

- **Cloud-poll transports** (Star CloudPRNT, Epson Server Direct Print) — a NAT'd printer with no
  agent. Low priority.

- **On-device agent** — a till hosting a print agent, the single-box venue's box-death printing path.
  Needs a native app; parked behind the go-native decision.

- **`runAgentOnce` (`packages/printing/src/runtime.ts`) has no caller in the tree outside its own package's tests** — C70, #866. A refused report still rolls back every job of its batch when the caller's transaction rolls back, so all of them print again (measured 2026-09-29 with a scratch probe). [Detail](backlog/printers.md#runagentonce-packagesprintingsrcruntimets-has-no-caller-in-the-tree-outside-its-own-packages-tests)

- **An aged batch can print twice** — found by #572 while pruning comments (`packages/printing`).
  When a large batch to a slow printer outlives the one-minute lease, another agent in the venue can
  re-claim the jobs not yet sent while the first agent still sends every job it pulled; the lease
  comment in `runtime.ts` now says so. [Detail](backlog/printers.md#an-aged-batch-can-print-twice)

- **Waitron carries two QR encoders; consolidate on `qrcode-generator`** — Small. Switch the three
  server sites over and drop `qrcode`; hoist the receipt's hand-ported money/date/label formatters
  into `packages/shared` too (the paper receipt already drifts from the screen by an NBSP
  normalisation).
  [Detail](backlog/printers.md#waitron-carries-two-qr-encoders-consolidate-on-qrcode-generator)

- **Printer lists that still read as empty while loading or after a failed read** — left open by
  A428, which fixed the reprint dialog, the device profile window's printer section and the
  Printers list's loading line. Still open: the Printers screen's printers, agents and jobs tables
  say "No printers yet.", "No print agents yet." and "No print jobs yet." after a FAILED read,
  beside the screen's refresh-failed message (sibling tables pass `errorMessage`); the devices
  screen's device editor is believed, from reading only, to offer just "Use default (None)" while
  its printer list loads; the device profile window, after its first printer read failed and before
  a later one succeeds, shows no printer section and no loading line, even while the next read is
  under way; after an empty printer list loaded and a later refresh failed, that window shows the
  failure but still says "Add a printer first.", because the shared query code does not say which
  read failed; its kitchen section says "Add a prep station or a watcher first." while stations and
  watchers load or after their read fails (read, not run); and Cancel in that window clears the
  screen's message without putting back a read failure that is still standing (read, not run).

- Choose one reset-on-dismiss policy for armed destructive row actions across printers and agents;
  migrate `?disabled=${busy}` buttons to `loading`; the seen-status is as of the last read, not a live
  presence light.

- **Since W72c an imported print agent arrives with no node; the importing box's own agent still
  enrols as a new row beside it**, as it did before (read, not run). Left open by W72c (#1237).

- **Adding a language to the venue also means adding its printer captions, and a language written
  outside the Latin letters means widening the font table.** The width ruler's captions are
  exhaustive over the locale list (`CAPTIONS` in `apps/server/src/test-page.ts`), so a new locale
  fails to compile until its captions exist.
  [Detail](backlog/printers.md#adding-a-language-to-the-venue-also-means-adding-its-printer-captions-and-a-language-written-outside-the-latin-letters-means-widening-the-font-table)

- **Whether a job of pictures still needs the print area (`GS L`/`GS W`) that receipts, category
  pages and the test page send is not measured.** The calibration ruler page sends a print area of
  576 dots whatever the printer. Left open by C107 (#974).

- **At 203 dpi a line could hold 32 columns on 58 mm paper (384 ÷ 12) and 48 on 80 mm (576 ÷ 12); it
  keeps 30 and 42.** Left open by C107 (#974).

- **The 28-dot line cuts letters: by the generator's own report, 67 of its characters lose at least
  one dot that was half inside the letter, most of them accented capitals losing the top of the
  accent.** Measured 2026-10-01 with a copy of the generator: a 30-dot line with the baseline 24
  dots down leaves 3 (ď, ĥ, ŉ), and 31 or 32 dots still leave those 3. Left open by C107 (#974).

- **The preview reads at most 4 MiB of a job and shows at most 2,048 blocks (one per printed line,
  feed, cut or QR code, among others), so a job of more than about 2,040 lines is cut short at any
  width.** The deep-tree case in `apps/server/src/category-sales-page.test.ts` printed about 14,500
  lines on 58mm paper once rows carried their whole path (W73). Left open by C107 (#974).

- **What a printer narrower than 576 dots does with the part of the ruler beyond its head is not
  measured.** The preview shrinks a picture wider than the job's line instead of cutting it, so on
  the ruler page, whose captions are 360 dots wide, the 576-dot ruler is shrunk on every printer.
  Left open by C107 (#974).

- **Follow-up (ruling C): the preview no longer shows the QR link as text** for a raster receipt.
  A possible fix is to carry the link alongside the print job so the preview can still show it as
  text.

- **Deferred (ruling H): the receipt logs no warning when no legal QR dot size exists.** No logger is
  reachable from `receipt-print.ts`, and in practice the fallback is unreachable today for any link
  `validate.ts` accepts (`apps/server/src/qr-link-range.test.ts`).

- **Building the QR raster runs inside the sale-recording transaction** (via `formatReceipt` in
  `enqueueSaleReceipt`). Left as an owner decision, not applied.
  [Detail](backlog/printers.md#building-the-qr-raster-runs-inside-the-sale-recording-transaction)

- **Still counted by the printer's `printer.jobs_waiting` alert after A167 (#975)**, measured with
  throwaway cases and not pinned.
  [Detail](backlog/printers.md#still-counted-by-the-printers-printerjobs_waiting-alert-after-a167-975)

- _2026-10-01 (3c-3): a dish moved to another station leaves its ticket at the old station's
  printer counted by that printer's stuck alert in the same way, because nothing reprints there._

- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
  [Detail](backlog/printers.md#the-virtual-pdf-printer)

- **Printing A4 invoices on an office printer** (owner, 2026-09-14): foundation landed in #1399;
  transport and screens remain in A231q.
  [Detail](backlog/printers.md#printing-a4-invoices-on-an-office-printer). The same remaining work
  is A231d's part 2, under _Fiscal records, invoices and the asesor_
  ([detail](backlog/fiscal.md#a231d-full-invoices-by-email-as-a-pdf-and-on-an-office-printer--part-1-landed-1399-part-2-open)).

- **Office-printer greying is proven on one office printer only.** The owner's HP Color LaserJet
  MFP M181fw's real reply is a test fixture, and the live query marked it from a Mac on the owner's
  network. It has not run from the box's container, and no receipt printer that answers IPP has
  been captured, so "A4 or letter means office printer" is a heuristic with one data point.

- **A printer reported by its `.local` name may stay addable.** From a Mac, resolving the HP's
  `.local` name took 5 seconds, past the 1.5-second limit, so it was left unmarked. Not tried from
  the box's container, where the lookup may fail outright; either way the printer stays addable.

- **A typed address receives one HTTP request on port 631** after its connection check succeeds.
  The 2026-09-12 address-check design allowed any unicast address (public, loopback, link-local)
  because the check sent nothing; that reasoning no longer covers the follow-up query.

- **No promise about how long a known-address check takes end to end.** The dialog polls and
  reports a fresh result, but nothing bounds the round trip from pressing the button to an answer.

- **While a discovery window is open, a device not reported within 45 seconds drops off the list**
  until its next report; 45 seconds does not cover every scan pass (C102, #953).

- **A404 — adding and calibrating a printer (owner, 2026-10-08; open; low priority; not queued —
  owner 2026-10-08: take it from here when a lane has room):**
  [Detail](backlog/printers.md#a404--adding-and-calibrating-a-printer)

- **A405 — printer details and the print queue (owner, 2026-10-08; open; low priority; not queued —
  owner 2026-10-08: take it from here when a lane has room; after A404).**
  [Detail](backlog/printers.md#a405--printer-details-and-the-print-queue)

- Read-back gap: the Impresoras editor leaves agent and transport re-binding read-only
  though the API accepts it. A261 step 8 retired the location print-mode and drawer-policy toggles.

- **One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still
  open:** No test pins what the two removed addresses, `/manage/receipt` and
  `/manage/location-settings`, open now. The paper-width dropdown names widths only, not printers,
  so two printers of one width at different resolutions cannot be told apart (owner's call). The
  list of widths comes from the last preview, which the page asks for again only when the receipt
  text changes or a width is chosen. [Detail](backlog/printers.md#one-receipts-settings-page-with-a-live-preview-c116-989-c120-1000-c121-996--still-open)

- **The Receipts preview redraws the whole receipt once per highlighted part** — left open by W111
  (#1261, the receipt's top block). W111 took the marks from 2 to 6, so one preview can draw the
  receipt up to 7 times, and the screen asks for a preview after each pause in typing. Not measured.
  [Detail](backlog/printers.md#the-receipts-preview-redraws-the-whole-receipt-once-per-highlighted-part)

- **Left open by #1261's review, not acted on (2026-10-05)** (W111, the receipt's top block): (1) no
  database trigger protects the logo image (the approved design adds no migration; the app-level
  `receipt` usage refuses a library delete); (2) a configuration import does not validate the
  `tenant_receipts` JSON (the print path reads it defensively instead); …
  [Detail](backlog/printers.md#left-open-by-1261s-review-not-acted-on-2026-10-05)

**Left open, for the owner, by C113 (#1014, one receipt language per location):**

- **A change is refused while an open order at the location holds a line**
  (`receipt.language_orders_open`; narrowed by C124, #1020, 2026-10-02, with core
  `0064_line_locale_triggers_text_only`). If a language is changed underneath an open bill by
  another road (the configuration import writes `invoice_locales` directly), the bill's next split
  answers an unmapped 500 `server.internal`. [Detail](backlog/printers.md#a-change-is-refused-while-an-open-order-at-the-location-holds-a-line)

- After a change, a paid counter sale with one dish a station took and one it did not is not
  blocked, and its send-to-prep route (`/prep`) then answers 409 `ticket.already_fired`, as it
  did before the change, and leaves the order's lines unchanged. No till screen calls that
  route.

- A placed order collected after a language change is filed in the new language (`sales.locale`)
  with its dish names as saved when its lines were added; when the new language is not among the
  languages those names were saved in, its receipt prints the new language's fixed words with a
  dish name in an old language. [Detail](backlog/printers.md#a-placed-order-collected-after-a-language-change-is-filed-in-the-new-language)

- The refusal's count of blocking orders is not shown on the Receipts tab of Venue settings: `codeMessage` fills
  in no values.

- The provisioning command (`waitron-provision`) and the configuration import can still store
  two languages, or one no pack offers; the first entry is what prints. Neither holds Catalonia
  to Catalan: only the Receipts route and setup do.

- `cfg.invoiceLocales` (`apps/server/src/till-config.ts`) is no longer read outside tests (by
  grep) and can be retired.

- The till reads its fallback receipt language and the allergen sheet's language only when it
  starts (again after a server switch or an enrolment), so a change reaches those after a
  reload. The on-screen ticket follows each sale's own language.

- The dev and demo seed's English mode stores `en-GB`, which prints the Spanish words beside
  English dish names; the Receipts tab of Venue settings shows it as the saved language although it is not
  offered.

**Bluetooth (read, not run, unless a line says otherwise):**

- **A command queued behind a slow pair can run out of time.** A second command waiting behind that
  pair can therefore expire on the server before it runs; its outcome is then ignored and the screen
  says "No answer from the print agent — try again" whatever actually happened.
  [Detail](backlog/printers.md#a-command-queued-behind-a-slow-pair-can-run-out-of-time)

- **A Printers screen element taken out of the page and put back does not restart its background
  status checks:** `disconnectedCallback` stops them and `connectedCallback` only reloads the lists
  (`apps/dashboard/src/screens/printers-screen.ts`). Today nothing puts the same element back; it
  matters only if the app starts keeping screen elements.

- **A failed Pair or Unpair shows the agent's reason as the agent wrote it, in English on both
  languages' screens** (a wrong PIN would read "No se pudo emparejar: wrong PIN").
  [Detail](backlog/printers.md#a-failed-pair-or-unpair-shows-the-agents-reason-as-the-agent-wrote-it-in-english-on-both-languages-screens)

- **At phone width a Bluetooth address breaks mid-group** ("00:11:22:33:44:5" then "5"), because
  of the width limit on the device details added on 2026-09-11.

- **Left open by C109 (#960):** the printer details' Active switch can still switch a paired
  Bluetooth printer off without unpairing it. [Detail](backlog/printers.md#left-open-by-c109-960)

- **An Unpair outcome that reaches the server after it dropped the command leaves the printer on**
  (120 seconds, `COMMAND_TTL_MS` in `apps/server/src/printer-bluetooth-commands.ts`); the owner can
  switch it off with Disable, which the row then shows.
  [Detail](backlog/printers.md#an-unpair-outcome-that-reaches-the-server-after-it-dropped-the-command-leaves-the-printer-on)

- **A Bluetooth printer no agent reports paired still waits with no reason on the job (A139's "not
  covered")**, as a USB printer no agent sees does. A140 left this as it is: it needs two agents,
  one of them older than A140.
  [Detail](backlog/printers.md#a-bluetooth-printer-no-agent-reports-paired-still-waits-with-no-reason-on-the-job-a139s-not-covered)

- **RFCOMM always uses channel 1.** Nothing looks up a printer's channel, so a printer whose serial
  port is on another channel fails each job with the connection error.

- **Follow-ups A140's review raised, not done (owner's call):**
  [Detail](backlog/printers.md#follow-ups-a140s-review-raised-not-done-owners-call)

**Owed at the box — nothing here has run on real hardware:**

- **Photographs and timings of pictures on paper.** The owner's photographs of a receipt, a kitchen
  ticket, the ruler page, a sample receipt and the test page (C108) on both printers are owed, and
  so are the box's timings (what to time: `docs/developers/testing-guide.md`, "How long a job of
  pictures takes to print on the box is not measured").
  [Detail](backlog/printers.md#photographs-and-timings-of-pictures-on-paper)

- **Nothing physical has been verified since #327:** discovery, paper output, whether a device knock
  reaches the box while the Add agent dialog is open, the five-line feed before the cut, Bluetooth
  discovery, and the receipt preview against printed paper. #324's slips, duplicates and drawer pulse
  have never produced paper either.

- **On-paper verification is still owed on the TM-T88III** (spec "Verification on paper" steps 1-6):
  whether the printer's built-in QR command prints anything at all, and whether the mandated 30-40mm
  QR size is meant to count the code's blank border or only its dark squares.

- **Repeat the 58mm physical receipt after the print-area fix.** The corrected paper output has not
  yet been printed.
  [Detail](backlog/printers.md#repeat-the-58mm-physical-receipt-after-the-print-area-fix)

- **Nobody has yet typed a real printer's address into Check a known address.** The first things to
  try on the box: add the Epson at `192.168.10.81:9100` (the sweep should also list it) and print to
  it; then type the HP's `192.168.20.56:9100`, which should come back as an office printer.
  [Detail](backlog/printers.md#nobody-has-yet-typed-a-real-printers-address-into-check-a-known-address)

- **The setup-page link is unproven on the box.**
  [Detail](backlog/printers.md#the-setup-page-link-is-unproven-on-the-box)

- **Bluetooth at the box.** A first real pairing, and an Unpair, through the dashboard and the
  agent, under the shipped AppArmor profile with bluetoothd's `autopair` plugin off — nobody has yet
  paired or unpaired a real printer through the dashboard.
  [Detail](backlog/printers.md#bluetooth-at-the-box)

- **Printing over RFCOMM from INSIDE the print-agent container (A140).** A real RFCOMM connection
  and print from inside the container under the shipped profile — CI's runners cannot load Bluetooth
  at all — and whether the printer gets every byte before the connection closes. The owner printed
  on channel 1 from the host only.
  [Detail](backlog/printers.md#printing-over-rfcomm-from-inside-the-print-agent-container-a140)

- **The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the
  box is not confirmed.** It needs the fixed image on the box first.
  [Detail](backlog/printers.md#the-owners-bluetooth-printer-was-listed-only-under-show-all-devices-a137--the-cause-on-the-box-is-not-confirmed)

- Not yet checked on paper: the logo, and the centred block, on the owner's box (FYI in the
  campaign's questions file). Local screenshots in `~/waitron-campaign/w111-shots/`.
  Left open by W111 (#1261, the receipt's top block).

- **For the owner:** a card taken on a connected machine that also prints a paper merchant slip
  opens no drawer; B30 covers only the machine Waitron does not talk to. Left open by service Task
  16 (#981).

- **A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN.**
  An agent told `not_approved` stops and needs resetting on its own setup page
  (`packages/print-agent/src/agent.ts`, the `not_approved` branch), so its request outlives a shut
  window instead. **Next action:** find a path, for example an agent that asks again on its own
  after a refusal, so agents follow the device rule.
  [Detail](backlog/printers.md#a-print-agent-cannot-be-discarded-when-the-join-window-shuts-a269-owner-2026-10-04--open)

- **Drop `printers.ticket_scope` at the next reset — OPEN (3d, W20).** — left open by the product
  folders work. Printing no longer reads the column. Dropping it rebuilds `printers`, so leave it
  until the venue reset that permits the rebuild.

- **Clear a failed watcher copy without printing or resending — OPEN (3d, P9).** — left open by the
  product folders work. A Reprint does not clear its failed job because watcher copies have no
  station or bill link.

- **Seen while looking at every modal at 1024px, not changed:** the printers screen's list of
  discovered printers keeps its details column capped (`min(28vw, 24dvh)`), so the details wrap
  while half the row stands empty; and the till's option picker puts each price far from its name.
  [Detail](backlog/printers.md#seen-while-looking-at-every-modal-at-1024px-not-changed)

- **The Printers screen's discovered-device rows' `data-test` names use the device alone** (W74d,
  #1242, left as it was): `discovered-row-`, `register-`, `pair-`, `forget-device-` and the rest,
  so a lookup by name finds the first row drawn for that device. Left open by W74 (deleting a
  category warns about exactly what will go, #1196).

- **A freshly added printer's wizard opens with a blue Save** — the campaign runner's ruling of
  2026-10-08, for the owner to confirm. Left open by A331 batch 3b (#1415).

- **The printer name dialog is titled "Add a printer" when its button says Enable** — seen and not
  changed. Left open by A331 batch 3b (#1415).

### Payments and card readers

_Formerly A6, and the old Track C's payments items; part of A9._ Detail: [backlog/payments.md](backlog/payments.md).

- **Two concurrent passes over `listAttempting` (`packages/payments/src/store.ts`; its one caller is
  the SumUp provider's `resolvePending`) do not both succeed**: #558's review measured
  `["fulfilled","payment.not_found"]`, so the second pass throws partway instead of skipping the
  rows the first resolved. The comment at `listAttempting` now says so. Found by #558 while pruning
  comments.

- **The two `provider.test.ts` cases named "throws payment.not_found" assert only
  `rejects.toThrow()`, not the code** — found by #570 while pruning comments
  (`packages/payments-stripe`). Reversal retry-safety (one persisted id per reversal) is still
  deferred: #570's review showed two identical `reverseViaStripe` calls get different idempotency
  keys, so a retried reversal sends a second real refund; the comment at `reverse.ts` says so.
  [Detail](backlog/payments.md#the-two-providertestts-cases-named-throws-paymentnot_found-assert-only-rejectstothrow-not-the-code)

- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe** — left behind by the
  tenant-column removal (#378, 2026-09-16). **Next action:** change it in the Stripe dashboard
  before any card payment is taken through a Stripe webhook.
  [Detail](backlog/payments.md#the-stripe-webhook-endpoint-still-has-to-be-repointed-by-hand-at-stripe)

- Bound the HTTP body read as well as the header wait in `sumup-client.ts` (move `clearTimeout` after
  `res.text()`); lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.

- Pre-existing `forward` retry backoff.

- **Product decision to take before production:** The orphan drift gate holds a customer's money
  pending a human, unbounded — nothing re-sweeps a closed period.

- **The card refund path records only after the provider call, with a fresh key each time.** **Next
  action:** give the reconciler's reversal, and any post-invoice refund route when one is built, the
  same durable-attempt rule. Left open by the service, ordering and billing plan.
  [Detail](backlog/payments.md#the-card-refund-path-records-only-after-the-provider-call-with-a-fresh-key-each-time)

- The reader pay's `tipOf` (`apps/server/src/till-sale.ts`) treats a `null` tip as no tip, against
  CLAUDE.md §3's rule that a default applies only when the field is absent; it predates B28, and
  paying a non-zero bill on the reader is believed to accept it the same way (read, not run). Next:
  a route case sending `tip: null` to `POST /api/pay`, then decide refuse or accept. Left by B28's
  review (#1005), not acted on, under service Task 17 (#991).

- After a free sale settles on the reader, a stale card-attempt mark on the order is left in place;
  manual Pay is believed to leave it the same way (read, not run). Left by B28's review (#1005), not
  acted on, under service Task 17 (#991).

- **A placed order with no invoice is not checked against stored card payments.** Its cancel sees a
  card running at the reader in this process, but not a stored payment its provider has not
  resolved, nor one captured and not yet filed; the cancel had no payment check at all before C126.
  Left open by C126 (cancelling an order whose invoice was issued credits it, #1030).

- **Task 4 (#832, every paper names all of a party's tables).** Not yet checked: the payment API's
  `/management-api/payments/stuck`, `/management-api/payments/bill-payments` and
  `/management-api/payments/bill-refunds` queries (`apps/server/src/payments-api.ts`), which read
  the same column. Left open by the table actions plan.
  [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)

- **A pending card refund does not refuse joining or unjoining tables, though the bill payments
  design says it does.** Nobody has yet checked whether either can change what the bill charges.
  **Next action:** the owner decides whether the code should refuse them or the design should drop
  them from the list; then a test that tries each during a pending refund.
  [Detail](backlog/payments.md#a-pending-card-refund-does-not-refuse-joining-or-unjoining-tables-though-the-bill-payments-design-says-it-does)

- **The SumUp Solo experiments** ([runbook](research/2026-09-10-sumup-solo-experiments.md)). Still
  open: whether we may supply the idempotency key, whether reader webhooks are signed, and whether
  `void` maps onto the refund endpoint. [Detail](backlog/payments.md#the-sumup-solo-experiments)

- **The deli's outage card machine** (the deli hardware design §5). Buy the standalone machine, and
  decide how a payment keyed on it and recorded in the till as a manual card tender is matched to
  the record SumUp keeps with no sale of ours attached — the reconciler's sweep, and whether it can
  see a manual tender at all, decide it. Replace the design's estimated prices with real quotes.
  [Detail](backlog/payments.md#the-delis-outage-card-machine)

- **The printer-cradle experiment** (hardware not yet owned). SumUp's OpenAPI has no `print` and no
  receipt option on a reader checkout, so we can neither request nor suppress a cradle slip. State the
  failing case first (the cradle stays silent), with a standalone payment as the control. Also unread:
  `GET /v1.1/receipts/{transaction_id}`, richer than the four fields the adapter keeps.

- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race); Stripe's reader list is one page; status never refreshes by
  itself, and polling must go through the passive-session controller.

- **The SumUp reconciler** — settlement-report audit and orphan self-heal. `resolvePending` is the
  interim backstop; without an affiliate key a create whose response is lost resolves `failed` and
  raises `payment.pending_outcome_unactionable` for a human.
  [Detail](backlog/payments.md#the-sumup-reconciler)

- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.

- **Stripe does not fill `CardDetails`**, so a Stripe card sale prints `Tarjeta` with no scheme/PAN/
  auth. Gated on the deli having a Stripe account, which it does not.

- **What M7b2 left open (a manager clearing a stuck card payment, #702).** When the reader poll
  times out or errors, `collect` cancels the reader action best-effort and fails the row. If that
  cancel fails and the customer then taps, the money is captured while the local row says `failed`;
  only reconciliation sees it.
  [Detail](backlog/payments.md#what-m7b2-left-open-a-manager-clearing-a-stuck-card-payment-702)

- **Slice 2 — the handheld NFC/QR link.** Also here: restoring `stripe_on_device` (Tap-to-Pay). NFC
  (W102, not queued: it needs a real NFC handheld and tag to probe — owner 2026-10-08) and
  Tap-to-Pay are still open. [Detail](backlog/payments.md#slice-2--the-handheld-nfcqr-link)

- **The webhook `recordSale` hand-off** (Mode 3) and the reconcile remediation UI. The hand-off sits
  BEHIND the `AsyncPaymentProvider` seam and is therefore provider-neutral — building it against the
  Stripe Checkout adapter that already exists forecloses no cheaper provider later.

- **A guest paying from their own phone** (owner idea 2026-09-18, parked — the surface it needs does
  not exist). The waiter hands a greeted table a QR code standing for its newly opened tab; the
  diner scans it, reads the menu, orders, watches what has been served and what is still coming, and
  settles at the end. The ordering surface itself is parked under _online ordering (SP15)_ and the
  customer-facing menu. [Detail](backlog/payments.md#a-guest-paying-from-their-own-phone)

- **Routing by BILL SIZE is allowed but is the smallest lever** (owner idea 2026-09-18, arithmetic
  in the research note). The card mix moves the crossover further than the bill size does, and the
  deli's own mix is a query once it trades, not a research question.
  [Detail](backlog/payments.md#routing-by-bill-size-is-allowed-but-is-the-smallest-lever)

- **Some card payments ask the cardholder to sign instead of enter a PIN — open question, nothing
  built.** Start by reading what the SumUp Solo actually does on a signature-required card (it
  belongs with the SumUp Solo experiments above), because if the reader owns the whole step there
  may be nothing for us to build.
  [Detail](backlog/payments.md#some-card-payments-ask-the-cardholder-to-sign-instead-of-enter-a-pin--open-question-nothing-built)

- **If demos use multiple tills at once, add a till label to each pending amount so the manager can
  choose the right one; the current page shows amounts alone.** Left open by A247 (a pretend
  connected card reader in Demo mode, W38, #1172).

- **A bad Stripe reader id reaches the add-reader dialog as `server.internal`, so it cannot be told
  from a server fault** — found during C47 part 2 and not fixed: the Stripe seat's `readers.add`
  (`packages/payments-stripe/src/card-provider.ts`) lets the Stripe library's own error through, and
  the error boundary (`packages/server-kit/src/error-boundary.ts`) answers anything that is not an
  `AppError` with `server.internal`.

- **The Stripe add-reader dialog (`packages/payments-stripe/src/dashboard/stripe-add-reader.ts`)
  shows "Reader ID" twice** — found during C47 part 2 and not fixed: a separate label carrying the
  help icon and then the input's own label, where `wt-input`'s `help` slot would do.

- **Tip-collection UI** — the only surface that COLLECTS a tip is the integrated-Stripe idle screen;
  cash, manual card and the handheld have none. A design decision per tender type. And `#onPayTab`
  flattens every server code but the two permanent fiscal refusals to one `sale.error` key, hiding
  `sale.empty_basket`.

- **The practice-mode simulator writes no `attempting` row**, so a switch during a practice card
  payment is never refused (read, not run). Left open by W97 (#1311), beside the owner's decision
  on in-flight writes ([till decisions](backlog/till.md#decisions-and-deliberate-limits)).

- **If the till never receives a bill reader payment's `device.profile_changed` answer**, its
  automatic resend under the same id gets the failed payment back and tells staff the card was
  declined: no card was charged, but the reason shown is wrong; the next tap starts a fresh
  payment (read, not run). Left open by W97 (#1311).

- **A provider that keeps sending data slowly, or a connection that is slow to open, can take
  longer** — a reader's status and the provider's available readers wait up to 250 seconds. Stripe
  gives up on an attempt after 80 seconds of silence once connected and tries three times (stated
  in `defaultMakeStripe`, `packages/payments-stripe/src/card-provider.ts`). A provider that keeps
  sending data slowly, or a connection that is slow to open, can take longer, since Stripe's limit
  is on silence, not on the whole answer. Left open by A255 (#1145, lane A's W18c).

- **The W48 test does not measure a real silent provider or the box's HTTP/1.1 connection limit.**
  The SumUp pairing dialog's status reads (`#pollTick` and `#unpairOrphan`,
  `packages/payments-sumup/src/dashboard/sumup-add-reader.ts`) are outside the limit, other
  screens' reads are not limited, and it was not measured in a real browser against a real silent
  provider. Left open by A260 (several card readers' status reads at once can use up the browser's
  connections to the box; W18c #1145 and W48 #1162).

### Users, sign-in and the dashboard shell

_Formerly A7, and the dashboard entries in the opening part of the old Track A (before A1); part of A9._ Detail: [backlog/dashboard.md](backlog/dashboard.md).

- **A398 — device-profile editor heading remains to align with the sub-page pattern.**
  The editor repeats the list title and has no parent link above the heading
  (`apps/dashboard/src/screens/device-profiles-screen.ts`, `#renderEditor`). Deferred from lane E's
  canvas-heading change because lane A's A366-5A changes that screen. Re-check its landed editor,
  then apply the parent link and one item-name `h1` while retaining the unsaved-changes check.

- **`date-utils.test.ts` has a test titled as guarding "against a vacuous pass"** — found by #612
  while pruning comments. `catalogues` in `apps/dashboard/src/i18n/strings.ts` is read by nothing
  but `i18n/t.test.ts` (`t.ts` registers `{ en, es }` with the kit), so that test's "registers
  en-GB" case tests nothing that runs.
  [Detail](backlog/dashboard.md#date-utilstestts-has-a-test-titled-as-guarding-against-a-vacuous-pass)

- **`reorder.test.ts`'s test names say an out-of-range move "clamps"; `reorder()` ignores it.**
  Found by #610 (`apps/dashboard/src/api` + `src/widgets`), not fixable in a comments-only change.

- **`setEmail` in `packages/identity/src/staff.ts`, unlike `updatePersonDetails`, never checks the
  new email against other people's pending emails** — found by #559 while pruning comments.
  Identity's coverage reads 99.85 statements / 99.75 branches, not 100: the
  `management_session.required` throw in `profile.ts`'s `ownSession`, as it stands since #554, is
  reached by no test.
  [Detail](backlog/dashboard.md#setemail-in-packagesidentitysrcstaffts-unlike-updatepersondetails-never-checks-the-new-email-against-other-peoples-pending-emails)

- **Dashboard leftovers from the coverage branch** — OPEN (found 2026-09-23, PR #538). `wt-dialog`
  re-sends the native dialog's `close` event as `wt-close`
  (`packages/ui/src/components/wt-dialog.ts`), and the native event arrives a task after the dialog
  closes — the same mechanism the catalogue screen's nested forms guard against (#741).
  `staff-screen.ts` and `purchases-screen.ts` have no guard; their tests wait out the late close
  rather than guard it (`staff-screen.test.ts`, `purchases-screen.test.ts`).
  [Detail](backlog/dashboard.md#dashboard-leftovers-from-the-coverage-branch)

- **A person row written from outside `packages/identity` still folds its key ASCII-only** — OPEN
  (found 2026-09-23, task F1's review wave). **What is left open:** every remaining writer outside
  `packages/identity` is a fixture or a seed, each still folding ASCII-only, and the column is still
  nullable, so nothing at the compiler stops a new writer forgetting it. **Next action:** decide
  whether the column becomes mandatory — which breaks every fixture at the compiler rather than
  silently — or whether a guard over the write sites is enough.
  [Detail](backlog/dashboard.md#a-person-row-written-from-outside-packagesidentity-still-folds-its-key-ascii-only)

- **Should an all-archived product selection show Archive greyed out rather than hidden?**
  Left open by W110c (#1271); A435-1 removes Enable and keeps Archive hidden for that selection.

- The dashboard's `es-ES` module default still needs the flip the till got in #170; check the
  dashboard money formatter for the same "doesn't follow the UI locale" bug.

- **Product decision to take before production:** A human account always keeps an email (no
  remove-email action; `setEmail` rejects clearing) — the rule now, rather than a missing UI path.

- **Task 1b** (#554, session cookies stored only as hashes). Nothing fails when the UUID shape
  screens in `requireSession` and the till logout route are deleted — a non-UUID value hashes to no
  row, so the screens now only save a lookup. Also open: now that both ends are `state`, the keys
  #426 dropped could be declared again — `sessions` to `persons`, and `management_sessions`,
  `totp_enrollments` and `google_oidc_states` to `persons`. Doing so would change what deleting a
  person does. Left open by SQLite slice 2.
  [Detail](backlog/dashboard.md#task-1b-554-session-cookies-stored-only-as-hashes)

- **Quantity-display follow-ups found while tracing A313, OPEN, unqueued:** the Top sellers table
  renders its quantity strings directly (`apps/dashboard/src/widgets/top-sellers-table.ts`), and the
  till's `trimQuantity` removes trailing zeros without localising a fraction's decimal mark. These
  are readings, not browser reproductions; reproduce them before changing their displays.

- **Dashboard at 1280 px: the overview's top-row cards have uneven heights.** Seen during A310's
  look (2026-10-07), OPEN, unqueued — not checked against `main`. Screenshots:
  `~/waitron-campaign-c/a310-shots/`.

- **`docs/developers/design-system.md` still says a list's Create action goes in a menu beside the
  table heading**, while Menus, Staff and Units put a text Add button at the heading row's trailing
  edge; the doc only names the exceptions, and whether the rule itself changes is the owner's call.
  Left open by W79 (#1186).

- **The row-highlight tests focus only the row's own button**, so nothing tests that a row
  highlights while another control in it, such as its Actions menu, has focus. Left open by W79
  (#1186, the Menus list).

- **A link marked `aria-disabled="true"` in a ⋮ menu (`wt-row-actions`) looks greyed out but still
  opens its page when clicked** (no screen marks one disabled yet; W88's busy-tree point would be
  the first). Left open by A380 (#1385).

- **`wt-data-table`'s opt-in `stickyHeader` is set only by the Products screen.** Other long tables
  (Orders, Staff, Payments and the rest) keep scrolling with the content column until someone
  decides they should opt in too; each would need its screen to give the table a bounded height, as
  the Products screen does. Left open by W80 (#1187).
  [Detail](backlog/catalogue.md#products-table-toolbar-and-headings-stay-in-view-w80-1187-left-open)

- **The table's Customise columns button is icon-only beside Filters and Select but has neither
  their look nor a tooltip.** Left open by W83's review (#1193), not started.
  [Detail](backlog/catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)

- **The icon button and its tooltip are a stylesheet and a handler each caller wires by hand, not a
  `wt-icon-button` component** — the Products table's Select is a native `<button>` because `wt-button` does not pass
  `aria-pressed` through, and the Structure tab's Reorder and Select toggles are hand-built icon buttons
  for the same reason. Left open by W83's review (#1193), not started.
  [Detail](backlog/catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)

- **Row menus in plain `<table>`s are unchecked at phone width.** None has a phone-width case and
  none was measured.
  [Detail](backlog/dashboard.md#row-menus-in-plain-tables-are-unchecked-at-phone-width)

- The reasons screen keeps its own copy of the role list and role names (C51 sorts its dropdowns by
  displayed name, with a separate seniority order for validation) and of the placeholder-filling
  helper in `apps/dashboard/src/widgets/menu-preview.ts`. **Next action:** move both into
  `@waitron/dashboard-kit` if a third module screen needs them. Left open by service Task 1 (#706,
  adjustment reasons).

- **Override PIN limits (C89, #951), for the owner** — **Next action:** the owner decides whether to
  add the countdown and make the limit required. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- On the dashboard, the language chooser's menu is now a native popover in the top layer (A187), so
  it paints over the alert pop-up (`.alert-toast` in `apps/dashboard/src/dashboard-app.ts`, which
  hangs below the banner at its trailing edge with `z-index: 40`, a stacking order the top layer
  ignores): where the two overlap, an alert arriving while the menu is open is hidden under it, and
  its countdown keeps running, since `wt-toast` (`packages/ui/src/components/wt-toast.ts`) pauses it
  only while the pointer or keyboard focus is on the pop-up. Decide whether an arriving alert should
  close the menu. Left open by C133 (#1045, the till's tabs fit one screen), under service Task 16
  (#981). [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **A keydown guard that cancels Escape while a save runs did not keep one dialog open.** Why that
  screen behaved differently has not been established. Left open by the service, ordering and
  billing plan (Task 1's reasons screen).
  [Detail](backlog/dashboard.md#a-keydown-guard-that-cancels-escape-while-a-save-runs-did-not-keep-one-dialog-open)

- **Left in the dashboard Orders plan and spec after #1034 landed beside C126:** their banners still
  say C126 "is to" credit the bill (it is built); the plan's owner-answers row 7 still says "Task 2,
  as written" for the dropped mark; its Task 1 voided-bill case still lists `invoiceNotCredited:
  false` with no pointer to the drop; and #1034 did not write its planned test that a cancelled bill
  with an invoice shows its credit note. Left open by C126 (cancelling an order whose invoice was
  issued credits it, #1030).

- **The dashboard shell restyle (#333) has not been checked on hardware.** It was only ever checked
  in screenshots on a desktop browser; nobody has walked it on the real box or a phone, so the
  narrow-viewport banner and drawer are unverified. That walk belongs with the display walkthrough
  in [ui-review.md](ui-review.md).

- **The older collapse-only sidebar test still needs a useful assertion (C35, #822) — OPEN.**
  Find a collapse-only case that needs the app's correction before changing or retiring that test.
  [Detail](backlog/dashboard.md#the-older-collapse-only-sidebar-test-still-needs-a-useful-assertion-c35-822--open)

- **Every dashboard sidebar section gets an info page — OPEN (owner, 2026-09-29).** A page saying
  what the section is for and what is in it, opened by the section's header. It was the answer to
  C35's question about the header of the section you are on; A161 (#979) has since answered that
  question another way — that header now collapses its section, as every other header does — so
  whether this page is still wanted, and what would open it, is the owner's call.
  [Detail](backlog/dashboard.md#every-dashboard-sidebar-section-gets-an-info-page--open-owner-2026-09-29)

- **What C38 left as it was (a generated display name is the first given name and first surname,
  #827, owner decision 2026-09-28).** Left as they were, from #827's review: unlike the two staff
  forms, the profile screen keeps a taken-name message beside the display name when a first- or
  last-name change regenerates that name (`apps/dashboard/src/screens/profile-screen.ts` drops only
  the changed field's refusal); and the two staff forms turn the refusal into a field message
  inside the form, where other dashboard forms receive field messages from their parent screen.

- **The purchase VAT line's other fields still use `min-width: 5rem`, which the design-token rule
  forbids.** Left open by C43 (money in the dashboard shows its currency sign, #830) and its
  decimal-entry work (A284).

- **Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open:**
  (3) nothing checks that a NEW dashboard table offers the chooser; … (6) the printers screen's
  view keys (`printers:agents`, `printers:table`, `printers:jobs`) are the only dashboard view keys
  that use a colon and lack the `waitron.` prefix — cheap to rename until a venue is live.
  [Detail](backlog/dashboard.md#every-wt-data-table-list-lets-each-person-choose-its-columns-c45-834--left-open)

- **A form's refusal message sits at the bottom of the form, above the buttons (C97, #961) — left
  open:** three dialogs still draw their own refusal because none has a `wt-form-actions` row in its
  footer to hand it to. Not looked at on screen after #961's review fixes.
  [Detail](backlog/dashboard.md#a-forms-refusal-message-sits-at-the-bottom-of-the-form-above-the-buttons-c97-961--left-open)

- **A form in a modal stops at `--wt-form-max-width` (C105, #965) — left open:** a
  `wt-disclosure`'s heading row (the product editor's Kitchen, Descriptors and Nutrition sections,
  among others) and a screen's own paragraphs still run the modal's full width.
  [Detail](backlog/dashboard.md#a-form-in-a-modal-stops-at---wt-form-max-width-c105-965--left-open)

- **`wt-form-error-summary` is deleted once nothing uses it** — left open by C47
  (#838/#839/#840/#841). Besides its own files and exports in `packages/ui-core` and `packages/ui`,
  the `packages/ui` workbench demo (`packages/ui/demo/main.ts`) and the consumer test page
  `packages/ui-core/test/consumer/main.ts`, which `packages/ui-core/test/package-consumer.test.mjs`
  loads, still use it.

- **The profile screen, opened with required details missing, marks those fields at once, before any
  press** (two existing tests pin it), unlike every other form. Left open by C47
  (#838/#839/#840/#841).

- **The form plumbing is hand-written per form** — left open by C47 (#838/#839/#840/#841):
  assembling the bottom message, waiting for the render and then calling `focusFirstInvalid`, and
  the state that remembers the first press and which refusals the person has since changed, in
  several different shapes.
  [Detail](backlog/dashboard.md#the-form-plumbing-is-hand-written-per-form)

- **The image picker's error message is not read to a screen reader** — left open by C47
  (#838/#839/#840/#841). The Choose image button inside it carries `aria-invalid` and takes focus,
  so a screen reader hears "invalid" with no reason. Since A200 the product editor's photo button
  (`apps/dashboard/src/widgets/product-editor.ts`) has the same defect.
  [Detail](backlog/dashboard.md#the-image-pickers-error-message-is-not-read-to-a-screen-reader)

- **A refused save of a venue service setting that saves at once shows twice** — found during C47
  part 2 and not fixed: beside the control and at the top of the panel (`render`,
  `packages/venue-service/src/dashboard/service-settings-panel.ts`), and the cases in
  `packages/venue-service/src/dashboard/service-settings-panel.test.ts` pin both.

- **`wt-switch` cannot be marked invalid** — found during C47 part 2 and not fixed: a server refusal
  of an adjustment reason's note-required switch would show its message but move focus nowhere.
  [Detail](backlog/dashboard.md#what-c47-part-2-found-and-did-not-fix)

- **A blue line along the top of a `wt-modal` editor's footer** — found during C47 part 2 and not
  fixed: in a screenshot of a `wt-modal` editor after a refusal that names no field, a blue line
  runs along the top of the footer, which looks like the modal's scrolling body showing a focus ring
  — not traced, and not checked against `main`; an observation from the implementer's session.

- **Request refusals that still land in the bottom message, or under a field in generic words — OPEN
  (left by C54, #853).** In the forms C54 surveyed (the dashboard, the setup wizard, and the
  adjustments, venue-service and media module screens) it kept the action working after a request's
  refusal and put a refusal naming a shown field under that field. **Next action:** the owner says
  which of these are worth doing.
  [Detail](backlog/dashboard.md#request-refusals-that-still-land-in-the-bottom-message-or-under-a-field-in-generic-words--open-left-by-c54-853)

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)** — the rule is in
  CLAUDE.md §3 and `docs/developers/conventions-ui.md`. Still open: the membership route, the
  adjustment approver, the refund override and the manual-refund confirmer have no one-answer test
  case of their own. Refusals thrown in `apps/server` itself (a malformed id or PIN) carry no
  `reason`.
  [Detail](backlog/dashboard.md#every-login-failure-is-one-answer-c95-930-owner-decision-2026-09-30)

- **The profile's "Current password" fills the signed-in person's saved password (C98, #934) — still
  open:** the sign-in page keeps its three inline copies of the hidden username field
  (`apps/dashboard/src/screens/login-screen.ts`). Also unknown: which browser and address the owner
  saw the empty field in.
  [Detail](backlog/dashboard.md#the-profiles-current-password-fills-the-signed-in-persons-saved-password-c98-934--still-open)

- **A new passkey is listed under the person's email, with their name as its display name (C99,
  #939) — still open:** the result has not yet been seen in a password manager.
  [Detail](backlog/dashboard.md#a-new-passkey-is-listed-under-the-persons-email-with-their-name-as-its-display-name-c99-939--still-open)

- **The passkey list says when each passkey was last used and which password manager holds it (C100,
  #945) — known limits:** neither the "Last used" behaviour after a passkey is deleted in the
  password manager nor the password-manager naming was tried with a real browser (the tests stand in
  for the WebAuthn library).
  [Detail](backlog/dashboard.md#the-passkey-list-says-when-each-passkey-was-last-used-and-which-password-manager-holds-it-c100-945--known-limits)

- **The browser's password manager is told which passkeys Waitron still accepts (C101, #948) — still
  open:** not observed in a real password manager — the tests replace the browser's methods.
  [Detail](backlog/dashboard.md#the-browsers-password-manager-is-told-which-passkeys-waitron-still-accepts-c101-948--still-open)

- **A403 — sign-in and passkey fixes (owner, 2026-10-08; open; low priority; not queued — owner
  2026-10-08: take it from here when a lane has room):** **Choosing a passkey on the password step
  asks to discard unsaved changes.** **Remove the passkey name field.**
  [Detail](backlog/dashboard.md#a403--sign-in-and-passkey-fixes-owner-2026-10-08-open-low-priority-not-queued--owner-2026-10-08-take-it-from-here-when-a-lane-has-room)

- **Review every permission: fewer, coarser, and consistently named** (owner, 2026-09-26). The
  review should propose the whole list: which permissions to merge, the names, and which role holds
  each, and then rename the call sites in one change. **Do it before the editable-roles item below**
  (owner, 2026-09-26).
  [Detail](backlog/dashboard.md#review-every-permission-fewer-coarser-and-consistently-named)

- **Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
  decision 2026-09-12, restated 2026-09-28: "especially because I want roles to be definable by the
  customer"; design not written). Detail under [Roles the admin can
  edit](backlog/dashboard.md#roles-the-admin-can-edit-a7): the ladder question decides the schema.
  [Detail](backlog/dashboard.md#roles-are-something-an-admin-can-add-and-edit-the-four-built-ins-are-only-defaults)

- **Dropdowns sort by the label the person reads, with `Intl.Collator`; a list in a lifecycle order
  says so** (owner decision 2026-09-12). Still open: `wt-combobox` does not sort its options, and
  `compareLabels`, now used by `wt-data-table`, passes no locale to `localeCompare`.
  [Detail](backlog/dashboard.md#dropdowns-sort-by-the-label-the-person-reads-with-intlcollator-a-list-in-a-lifecycle-order-says-so)

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

- **Dashboard-wide location context** — one persistent location dropdown in the banner; classify
  every screen and API as venue-wide (the whole database) or location-scoped first.

- **The admin's Edit user form has no Language** chooser; a person's `locale` can only be set on Your
  profile.

- **Typed values are only partly checked — a generic phone-format check landed, a country-specific
  one has not.** Still open: the country-pack seat (`CountryPack.telephone`, filled by
  `validateSpanishPhone`) is still not called, so a Spanish mobile that fails the national rule but
  passes the generic one is still accepted.
  [Detail](backlog/dashboard.md#typed-values-are-only-partly-checked--a-generic-phone-format-check-landed-a-country-specific-one-has-not)

- Still open from #298/#305/#317, device checks before deployment: passkey reauthentication for a
  passwordless account; an operator screen for Google provider credentials; native passkey prompts on
  real hardware; a physical authenticator ceremony; live SMTP through `startServer`; whether an
  intermediary cache honours `Vary: Accept-Language`. #328's overlapping-dialog state was reached
  from code only; nobody has shown a real pointer can get there.

- **Three older dashboard screens name languages with their own code rather than
  `languageDisplayName` (`packages/shared`)** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.

- **When live updates are off and every Hours read both fails and takes longer than the 60-second
  refresh, no error is shown: the dashboard's request code sets no timeout on a read** — left open
  by A261 step 5 (Hours). Found in #1298's review; I believe it predates the branch (not checked
  with `git blame`).

- **`wt-data-table` searches a column's sort value when it has no search value**, so a number
  column matches typed digits unless it opts out; changing that default needs a check of every
  table that searches prices or counts.

- **Two blocking derivations remain OPEN** — left open by W1 (#1117), secret checks and the write
  lock. `hashSecret` derives with `scryptSync` (`packages/identity/src/secret-hash.ts`), so minting
  a token or setting a PIN or password stops the event loop; and `deriveKey`
  (`apps/server/src/scrypt-kdf.ts`) runs `scryptSync` too…
  [Detail](backlog/dashboard.md#secret-checks-and-the-write-lock-the-pin-manager-login-and-profile-checks-moved--done-w1-1117-two-blocking-derivations-and-one-stale-answer-window-remain-open)

- **`verifySecretAsync` could be renamed `verifySecret` (optional)** — left open by #912's review
  (secret checks and the write lock).
  [Detail](backlog/dashboard.md#secret-checks-and-the-write-lock-the-pin-manager-login-and-profile-checks-moved--done-w1-1117-two-blocking-derivations-and-one-stale-answer-window-remain-open)

- **A till sign-in whose PIN is not text answers 500, not `pin.invalid` — OPEN (found 2026-10-03 by
  W1).** **Next action:** refuse a non-text PIN as `pin.invalid`, with a failing case first.
  [Detail](backlog/dashboard.md#a-till-sign-in-whose-pin-is-not-text-answers-500-not-pininvalid--open-found-2026-10-03-by-w1)

- **A burst of till PIN sign-ins derives a key for every attempt — OPEN (found 2026-10-03 by W1).**
  `POST /api/session` (`apps/server/src/till-api.ts`) checks its throttle before any failure is
  recorded, so attempts sent at once all pass it. **Next action:** give the till sign-in the same
  turn-taking (`inTurn`, `apps/server/src/attempt-turns.ts`) or an in-flight refusal.
  [Detail](backlog/dashboard.md#a-burst-of-till-pin-sign-ins-derives-a-key-for-every-attempt--open-found-2026-10-03-by-w1)

- **Ongoing — the dashboard UI overhaul, screen by screen.** Every screen is being brought onto one
  shared look, and the rules for it live in [design-system.md](developers/design-system.md). The
  till (`apps/till`) and the setup wizard (`apps/setup`) are separate apps drawing on the same
  shared components. Whether they follow in this pass or later is open — decide it before the
  component rules harden around the dashboard alone.
  [Detail](backlog/dashboard.md#ongoing--the-dashboard-ui-overhaul-screen-by-screen)

- **Open, and it bites this work first: two documents state the component rules and they have
  drifted** (found by the #337 review). **Next action:** decide whether the token rule binds views
  as well as components, then make the guard and both documents agree. Whoever picks up the next
  screen should settle this first, because every screen after it inherits the answer.
  [Detail](backlog/dashboard.md#open-and-it-bites-this-work-first-two-documents-state-the-component-rules-and-they-have-drifted)

- **Also open, and product-wide: the primary blue fails the accessibility contrast bar as text on
  the page background, in the light theme.** Light `--wt-color-primary` (`#1f6feb`) on
  `--wt-color-bg` (`#f7f7f8`) is 4.33 to 1, under the 4.5 to 1 WCAG AA minimum for normal text
  (`packages/ui/src/tokens/colors.css`). **Next action:** an owner colour call — darken the light
  theme's primary until it clears 4.5 to 1 as text, or rule that the token is never text on the
  page background and add a check that says so.
  [Detail](backlog/dashboard.md#also-open-and-product-wide-the-primary-blue-fails-the-accessibility-contrast-bar-as-text-on-the-page-background-in-the-light-theme)

- **Nothing stops the next screen styling `wt-data-table` cell markup with a class.** A check that
  compares the class names a screen's own stylesheet styles against the class names it puts inside
  `wt-data-table` cell callbacks looks feasible; nobody has tried to write it. Left open by product
  categories (#340).

- **The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25).**
  Safari was not tried, so what it draws with no colour chosen, and whether the ring and the
  rim-free fill hold there, is unknown; and whether choosing black in the browser's picker from the
  no-colour state registers was not run. **Next action:** try the first in Safari or Playwright's
  WebKit, and the second by hand in Chromium. From "Review points left for the owner".
  [Detail](backlog/dashboard.md#the-colour-fields-custom-square-appsdashboardsrcwidgetscolor-fieldts-left-by-c25)

- **`--wt-cell-name-max-width` is used in three different directions, and is named for one.** Some
  consumers CAP a name cell with it, others use it as a `min-width` FLOOR, and one uses it as a FLEX
  BASIS on a combobox. **Next action (design decision):** a second token for the floor, or one
  shared sizing value used three ways.

- **The Payments screen's readers table gets no button**, because "Add reader" sits beside each
  connected provider (none, one or several), so there is no single Add to put there, and the list
  is pre-filtered by status; and the menu prices table on a menu's Price overrides tab gets none
  either, because its rows come from "Add products" on the Structure tab.
  Left open by A176 (an empty table shows a proper empty box, with the screen's Add button, #1033).

- **Not covered: empty sentences outside a `wt-data-table` (floor, kitchen, devices and others)
  still use "Aún no hay" and other shapes.** Left open by A177 (one fixed "nothing matches"
  sentence; a specific "nothing yet" sentence per screen, #1037).

- **That saved-password visual check remains unverified** — an isolated Chromium profile accepted
  a saved test password through `navigator.credentials.store`, but did not autofill it after a
  reload or restart under automation; that saved-password visual check remains unverified. Left
  open by A190 (a field the browser fills in keeps the field's own look, #1047).

- **The new key and passkey icons draw lines at width 2** while the change-account icon beside them
  uses 1; the card copies the setup wizard's card styles rather than sharing `wt-card`, and nothing
  keeps the two in step. Left open by A191 (the dashboard's sign-in pages, #1074; owner to decide).

- **The "Continue with Google" button was checked in Chromium only** (the vitest browser suites and
  screenshots); Firefox and Safari not looked at. Left open by A228 (#1078).

- **The error-styled notice keeps `role="status"`** (read out politely, as the item asked), where
  the dashboard's other error text uses `role="alert"` (read out at once); switching it is a
  one-line change if wanted. Left open for the owner by W103 (the login card's session-expired
  notice is drawn as an error, #1190).

- **Other non-table dropdowns offering an empty "Any …" or "No …" row** were outside A193; their
  appearance needs a separate review. Left open by A193 (a table filter's "Any …" choice is drawn
  as a chosen value, #1084).

- **The owner has not confirmed whether one common width was intended for every filter**; this uses
  one stable width per filter. A filter whose longest choice exceeds the available phone width
  fills its row, and that choice is cut short in the closed control. Left open by A194 (a table
  filter's dropdown keeps one width whatever is chosen, #1085).

- **Left as it was: the focus ring of a row's button shows only along the row's top edge**, in both
  tables, as on the shared table. Left open by W71 (clicking an Extras or Options list's row
  opens its editor, in the product editor and on the Modifiers page, #1192).

- **Left as it was** (#1142's run-it review, which found the same on `main`): **on Device profiles,
  a failed one-off reload's message can stay after fresh data arrives.** Left open by A224 (dashboard
  reads have no time limit, #1125, #1135, #1142).

- **Empty-state text shows beside a failed read on Payments and Cloud services (A252, seen 2026-10-03
  while checking lane A's W18) — OPEN.** It is the kind of empty-state text W18 removed from
  Roster and Planned vs actual.
  [Detail](backlog/dashboard.md#empty-state-text-shows-beside-a-failed-read-on-payments-and-cloud-services-a252-seen-2026-10-03-while-checking-lane-as-w18--open)

- **The dark logo's colours are copies of the dark theme's (A253, 2026-10-03, from A225) — OPEN.**
  **Next action:** have `build-icons.mjs` read the two dark values from `colors.css` when it runs,
  so there is no copy to keep in step.
  [Detail](backlog/dashboard.md#the-dark-logos-colours-are-copies-of-the-dark-themes-a253-2026-10-03-from-a225--open)

- **`wt-relative-time` also keeps disclosure state from `toggle` and has document listeners**
  (open, untested; A369 review). Next: reproduce open/remove/reinsert, including removal before the
  opening toggle arrives, before deciding whether it needs the same lifecycle correction. Left open
  by A369 (removed popovers reset their open state, #1390).

- **Modifiers' Status and Printers' Agent/Printer Status filters still receive column lists built
  during render** (A370 caller audit, code reading only). Their redraw work was not measured in this
  item. Next: measure it before deciding whether to retain those lists. Left open by A370 (#1393).

- **Contrast that axe leaves undecided for any other reason passes** — still not checked, left
  open by A226 (#1092): among them an overlapping element (such as an empty `wt-input`), a
  background image or gradient, content too short or not text — passes, so contrast in those
  places is checked by nobody.

- **`--wt-color-primary-text` has fixed light and dark values that do not follow
  `--wt-color-primary`, and a tenant theme cannot set it** — left open by A218 (#1082):
  (`THEMEABLE_TOKENS`, `packages/layouts/src/theme.ts`) — no screen applies a stored tenant theme
  yet. The same holds for `--wt-color-primary-hover` and `--wt-color-danger-hover` (A306), which
  do not follow `--wt-color-primary` and `--wt-color-danger`, so a tenant or deployment that sets
  only `--wt-color-primary` or `--wt-color-danger` gets Waitron's default blue or red on a hovered
  primary or danger `wt-button`.

- **Three labels already on `main` fill `{…}` placeholders one after another, so a name holding
  `{from}`-style text or `$&` can garble them** — left open by A423 (#1443): the colour chooser's
  heading (`apps/dashboard/src/widgets/catalogue-browser.ts`), the order detail dialog's `fill`,
  and the "price per" unit text in `product-list.ts` — #1443 fixed its own two with
  `fillPlaceholders` (`apps/dashboard/src/widgets/product-media.ts`), and four screens keep a
  private `fill` of the same kind that could share it.

- **One earlier Spanish dark-theme 390 px demo probe reached its 12-second deadline before the
  bottom** — left open by A334 (#1416, held reorder drags scroll at the list edge): a later
  instrumented eight-case matrix reached the bottom in every case. The earlier cause is
  unverified. If it recurs, capture the current scroll/limit, pointer position, drag state and
  visible box before attributing it to the scroll helper.

- **Re-check the venue-service screens for the save rule once after A366 slice 7 (A331, owner
  2026-10-08)** — OPEN. Each A366 slice builds the rule into the forms it creates or rewrites;
  after slice 7 lands, run A331 batch 4b's audit once more over
  `packages/venue-service/src/dashboard/` and gate any form a slice missed.
  [Detail](backlog/dashboard.md#a-forms-save-stays-quiet-and-disabled-until-something-changes-a331-owner-2026-10-07)

- **The Departments and zones inline name editors put Save before Cancel**, while the screen's
  editor window puts Cancel first, as `design-system.md` → Forms asks. Left open by A331 batch 4b (#1462).

- **Service-status colour-field labels are clipped (found during W69, 2026-10-06) — OPEN.**
  The native status colour fields show an ellipsis instead of the full label in the inspected
  EN/ES service-status captures at 390 and 1280 px, both themes. Next action: reproduce in Venue
  settings → Tables and adjust the colour-field width using the shared field contract without
  changing status colour data.
  [Detail](backlog/dashboard.md#service-status-colour-field-labels-are-clipped-found-during-w69-2026-10-06)

- **A password manager filling the profile's current-password field** — the owner tried Chrome's
  password manager on 2026-10-08 and reported that it works well; other password managers are
  untried. Left open by A331 batch 3a (#1401).

- **Other purchases-screen, staff-screen and roster-screen tests still send made-up create and update
  events** (`create-purchase`, `update-purchase`, `create-person`, `save-person`, `update-shift`)
  instead of pressing the form's button; they pass, but never prove the button works. Left open by
  A331 batch 3a (#1401).

- **Once put back with an edit, keyboard focus is outside the dialog, and Escape neither asks nor
  closes until focus is back on a field inside the dialog** — seen in the purchase and shift forms'
  tests, not changed and not tried by hand (the tests put it there with `focus()`; a click was not
  tried). Measured (`~/waitron-campaign-c/item-a397-measurements.md`, A397.2): after a put-back, focus
  is on the page body and the dialog is no longer modal; the measurements attribute this to how
  `wt-dialog` handles being put back. Left open by A397 part 1 (#1429), under A331 batch 5.

- **On a hovered Products row in the dark theme, status and allergen badge borders appear to
  disappear into the row** — the earlier screenshot-only observation remains open. Contrast for those
  borders, a category row's maker link and the prep stations screen remains unmeasured. Left open by
  A319 (hover contrast after A306, #1347).

- **The two dropdown explanations on venue service's Kitchen panel in Venue settings ("Applies to
  new kitchen tickets and to reprints." and the release reminder's) are now each dropdown's `hint`**
  — left open by A178 (#1010 to #1019), seen while building, not changed; for the owner: which a
  field that always holds a value never shows, so only screen readers read them while the two
  switches beside them keep visible lines.

- **Text size after A179 (#988).** Open: page headings follow the Typography roles table in
  `docs/developers/design-system.md` (a page title at `--wt-font-size-xl`) only in part. **Phone
  check, the owner's to do (2026-10-01: "i'll test phones later on"):** Safari on iPhone is widely
  reported to zoom the page in when a field whose text is under 16px is focused — not yet tried
  here. [Detail](backlog/dashboard.md#text-size-after-a179-988)

- **Dragging a row (A180, #994 and #1003) — two things seen, left as they were.** A lifted row in a
  reorder list (`ReorderController`, `apps/dashboard/src/widgets/reorder-table.ts`) shows a faint
  line at each cell boundary, most visible in the dark theme, and a row lifted at the bottom of its
  list has its shadow cut off where the table ends.
  [Detail](backlog/dashboard.md#dragging-a-row-a180-994-and-1003--two-things-seen-left-as-they-were)

- **The overview's top-sellers table can reach into its card's padding at desktop width** (12px into
  the 17px padding, measured 2026-09-24 at 1280px). **Next action:** decide whether a long name
  there may wrap mid-word.
  [Detail](backlog/dashboard.md#the-overviews-top-sellers-table-can-reach-into-its-cards-padding-at-desktop-width)

### Interface languages

_Formerly entries spread across the old sections, C125 among them; part of A9._ Detail: [backlog/languages.md](backlog/languages.md).

- **The recovery page's Spanish (#650) has not been read by a native speaker.** Left open by SQLite
  slice 2 Task 3a (#566, one process per venue folder; #573; #608).

- **The file pickers' "Choose File / No file chosen" follow the browser's language**, not the
  chooser; the browser draws them. Left open by C42 (#837, the setup wizard in Spanish and
  English).

- **English-only till entry pages, OPEN, unqueued (A379 source audit).** The development device
  chooser (`apps/till/src/screens/till-device-chooser.ts`) contains fixed English headings and
  actions, and the certificate trust instructions (`apps/till/src/main.ts`) have fixed English
  prose. Reproduce in Spanish before deciding their translation scope; this branch changes the
  standard selling tabs only.

- **Restaurant menus are “carta” in the Spanish dashboard, module, setup and till wording** (owner
  decision 2026-09-29; C55 #858, C56 #901). Account and row-action menus keep “menú”.
  `apps/till/src/i18n/strings.test.ts` fails if a Spanish string in the till's catalogue says
  “menú”; the till's error-code messages and allergen names (`apps/till/src/i18n/codes.ts`,
  `apps/till/src/i18n/allergen-names.ts`) are not scanned.

- **Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all
  four (C125, owner 2026-10-02) — PARKED by the owner (2026-10-02: "save the full translations for
  much later"); taken out of the campaign queues the same day.** Nothing was written: the
  `docs/regional-languages` branch holds no commit and no draft.
  [Detail](backlog/languages.md#catalan-valencian-galician-and-basque--the-receipts-words-checked-and-the-whole-app-in-all-four-c125-owner-2026-10-02--parked)

**Left open, for the owner, by C113 (#1014, one receipt language per location):**

- **The payment slip was left alone.** Its words («JUSTIFICANTE DE PAGO», «Importe», «Cobrado»)
  stay Spanish (`apps/server/src/payment-slip.ts`), and its date and amounts still follow
  `WAITRON_TILL_LOCALE` (`apps/server/src/payment-slip-print.ts`).
  [Detail](backlog/languages.md#the-payment-slip-was-left-alone)

- **The translations need a native or official check before go-live.** Apart from the Catalan
  «Factura» and «Propina», which the Consumer Code and the agency's pages use, no word in the table
  was checked against a terminology source. [Detail](backlog/languages.md#the-translations-need-a-native-or-official-check-before-go-live)

- The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish way
  (`20,00 €`, `5 ago 2026`), while its words are Galician or Basque. The printed receipt is
  formatted on the server and keeps the language's own pattern. [Detail](backlog/languages.md#the-tills-on-screen-ticket-writes-a-galician-or-basque-sales-amounts-and-date-the-spanish-way)

- The printed Basque date is the formatter's own pattern, «2026(e)ko urt. 15(a)», and drops to
  its own line on 58 mm paper.

- The sample receipt the preview draws keeps its Spanish content («Mesa 6», «MUESTRA/1»,
  «Café y tostada») in every language; only its fixed words change.

### Alerts, logging and diagnostics

_Formerly A5, and the logging part of A9._ Detail: [backlog/alerts.md](backlog/alerts.md).

- **`redact-secrets.ts` was written against the PostgreSQL connection-string parser** — found by
  #620 while pruning comments. `pg` is now installed only for `bench/pglite-throughput`; whether a
  credential-bearing URL can still reach the log is unchecked.
  [Detail](backlog/alerts.md#redact-secretsts-was-written-against-the-postgresql-connection-string-parser)

- **Still not built: a standby that has fallen behind** — left open by "Dashboard alerts and the
  incidents surface" (A5, LANDED #363/#368/#371).

- **A low-battery alert (A272, idea, 2026-10-04) — OPEN.** A268 shows each device's battery on the
  Devices list; nothing alerts when a handheld runs low.

- **The alert check that every money slot is marked looks only at slots named `amount`, `captured`
  and `expected`, so a new money slot under another name is unseen.** Left open by C43 (money in
  the dashboard shows its currency sign, #830).

- **Logging Slice 2 — one-touch bug report**, then Slice 3 triage and forwarding, with the Slice 1
  hardening (client-trail key allowlist, `maskPath` PII, the setup app). Detail under
  [Logging, diagnostics & one-touch bug report](backlog/alerts.md#logging-diagnostics--one-touch-bug-report-a9-slice-1-landed-192).

- **The Alerts table makes long station warnings hard to read on a phone.** — left open by the
  product folders work. Give the alert text more room at phone width while keeping its handling
  action reachable.
  [Detail](backlog/alerts.md#the-alerts-table-makes-long-station-warnings-hard-to-read-on-a-phone)

- **A provider call that ignores cancellation may continue after the server has answered**; the
  source's five-minute cache shares that in-flight call with reads during its lifetime. Left open
  by the A258 follow-up (the alerts list's battery check has its own deadline, W58, #1176).

### Working time and staff

_Formerly A10; part of A9._ Detail: [backlog/workforce.md](backlog/workforce.md).

- **A shift that runs past midnight (22:00–02:00) is refused as `shift.invalid`** — left open by W22
  (#1134), found by #1134's review. And an edit keeps the shift's stored offsets, so moving a shift
  across a summer-time change keeps the old offset. Next action: let the dialog put the end on the
  next day when it is not after the start, and derive each offset from the venue's time zone for the
  date.
  [Detail](backlog/workforce.md#a-shift-that-runs-past-midnight-22000200-is-refused-as-shiftinvalid)

- **Wages / labour cost (SP16)** — a per-person pay-rule set (hourly or fixed salary for N contracted
  hours, rate overrides by condition of the hour, paid non-worked states) turning recorded and
  scheduled hours into accrued-versus-pending money. Rates are editable data, never hardcoded convenio
  numbers; needs a public-holidays calendar. Gated on the labour advisor; not fiscal.

- **A10. Clocking in and out — the working-time record** — **Staff cannot clock in or out today.**
  The _registro de jornada_ is a legal duty from the first day the deli employs anyone
  ([design](superpowers/specs/2026-07-22-workforce-and-time-record-design.md)). **Before building,
  ask the labour advisor** whether the digital-registro decree is in force and which fields it
  requires ([asesor-laboral-questions.md](compliance/asesor-laboral-questions.md)).
  [Detail](backlog/workforce.md#a10-clocking-in-and-out--the-working-time-record)

### Purchasing, recipes, stock and reports

_Formerly entries spread across the old sections._ Detail: [backlog/back-office.md](backlog/back-office.md).

- **The recipe routes and the recipe screen are unreached** — found by #615 while pruning comments.
  Next action: the owner decides whether to delete `recipe-api.ts`, the screen and the client
  methods, or to remount the routes and route the screen.
  [Detail](backlog/back-office.md#the-recipe-routes-and-the-recipe-screen-are-unreached)

- **The recipe screen's `#loadRecipe` guard compares product ids**, so choosing A, then B, then A
  again lets the first A answer apply and turn Save back on while the second A load is still
  running. Found by #607 (`apps/dashboard/src/screens`), read only, not run.

- **A supplier credit note cannot be entered through the dashboard** — OPEN, unqueued. A negative
  gross total on the purchase-invoice routes is a supplier credit note and is accepted and stored by
  design (owner ruling 2026-09-21; task N1). Nobody has decided whether the form should be relaxed
  or the credit note should become its own document type.
  [Detail](backlog/back-office.md#a-supplier-credit-note-cannot-be-entered-through-the-dashboard)

- A weighed item cancelled in part can differ by a cent between the cancel's list value and what
  stays on the line, so a rate can be a cent's share off. **Next action:** none unless someone sees
  it matter. Left open by service Task 12 (#923, adjustment reports).

- With no day picked, a screen left open past the day's cutover moves to the new, empty day; the
  date inputs show it, nothing announces it. **Next action:** decide whether it should keep the day
  it opened on. Left open by service Task 12 (#923).

- **Recipe authoring is gone from the dashboard, and nothing replaces it as a surface.** The parked
  recipe depth work (nested sub-recipes, plate costing, stock depletion) assumes an authoring
  surface that no longer exists. **Next action:** whoever reopens recipe depth decides first whether
  recipe authoring returns as its own surface.

- **Once other fields in a purchase line show errors, its VAT-kind dropdown sits lower than its
  neighbours** (`.line { align-items: flex-end }` in `purchase-form.ts`) — left open by A178 (#1010
  to #1019), seen while building, not changed.

### The box: backups, upgrades and recovery

_Formerly B2, B3, B4, B5 and B7._ Detail: [backlog/box.md](backlog/box.md).

- **S3-compatible bucket, then Google Drive.** The bucket stream of `venue.db` is built (slice 2);
  the archive's S3 backend is not — only `LocalFsBackend` exists for archives. The abort-aware
  per-destination timeout lands with the first network backend.

- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
  [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **Backup & restore — carry-forwards (B2)** — left open by the restore hook (SP-3d, #248) and the
  dashboard wizard (#295). Named carry-forwards: a stale-`.tmp` sweep; confirm the `StorageBackend`
  key path-traversal guard landed with BR-3's manifest-driven `get(key)`; a working-backup boot
  success-path integration test; scope the flat `resolvers` map by module when a second `nonDbState`
  module lands; a `packArchive` pack-time entries bound; a manifest-shape coded refusal (it fails
  safe under GCM auth today); generalise archive entry routing off declared source ids when a second
  non-DB source lands. [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **When a nightly report job exists, the backup slot should fire after it** — left open by the "backups off or stale" reminder (#371).

- **The remaining cold-restore operator surface** (promote Slice 4): connection rebinding, advertised
  origin and an authenticated entry.

- **Reconsider the backup container against off-the-shelf tools** (a brainstorm): `WBA1` plus
  `artifact-cipher.ts` holds the whole database copy in memory and is restorable only by Waitron
  code, where piping the engine's own copy through a standard encrypter into a tar is the obvious
  alternative.

- **B3. The bootable USB installer** — Runs `waitron.sh install` unattended. Open questions it owns: whether the stick carries the images so
  install needs no internet; unattended updates for a box we did not sell; AP-mode WiFi onboarding. Box
  image constraints under [Box image constraints (B3)](backlog/box.md#box-image-constraints-b3). Not started.

- **The box image carries the WireGuard link.** [Detail](backlog/box.md#box-image-constraints-b3)

- **Kiosk options, none built:** Chromium in the box image, now the owner's lean for every box (B3,
  2026-09-29), and, later, Fully Kiosk resale for dedicated tablets. Four traps to establish when the
  image is built (the crash-restore dialog, Chromium's separate certificate store, screen blanking,
  BIOS power-loss behaviour) in
  [2026-09-18-handheld-and-till-hardware-decisions.md](superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md)
  §5. [Detail](backlog/box.md#box-image-constraints-b3)

- **The box the customer buys probably doubles as a till, so the image ships a screen and a browser** — owner, 2026-09-29. A lean, not yet a decision. **Open:** whether the box's own screen enrols as a till like any other device or is treated differently because it is local, and what address it opens the till at. [Detail](backlog/box.md#the-box-the-customer-buys-probably-doubles-as-a-till-so-the-image-ships-a-screen-and-a-browser)

- **a local maintenance account on each box** — belongs with B3; a discussion record, not an approved spec. Its remote-support half is tracked in Cloud and not approved. [Detail](backlog/box.md#a-local-maintenance-account-on-each-box)

- **Upgrade testing — blocking before go-live (owner, 2026-09-26).** Still open: rows the product itself writes. Every step here is built by this image's own migrator from today's change-feed and append-only lists; a snapshot of a box at an earlier release, upgraded by the new image, is the test that matches what a box does. [Detail](backlog/box.md#upgrade-testing--blocking-before-go-live-owner-2026-09-26)

- **Automatic upgrades that can be undone until the first order** — owner, 2026-10-02. It takes no backup first, and once the new image has migrated the database there is no way back — an older image then refuses to start with `provisioning.database_ahead` (`deploy/README.md`, "It can migrate the box's database one way"). The point of no return is the first order taken on the new version, not the restart: rolling back after that would lose the order. [Detail](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order)

- **Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check.** [Detail](backlog/box.md#every-migrating-path-but-boot-and-the-bucket-rebuild-runs-with-no-ahead-of-image-check)

- **Provisioning's migrate path still runs the linear full `manifestSets()`** — route it through the
  resolver once it gains per-module enablement.

- **What `waitron.sh install`'s self-refresh (C83, #890) left open:** No case in `scripts/waitron-sh.test.mjs` covers a script not run from a file, a link `readlink -f` cannot follow, a folder the script cannot enter, or a box with neither curl nor wget. [Detail](backlog/box.md#what-waitronsh-installs-self-refresh-c83-890-left-open)

- **What `waitron.sh --reset install` (#1122) left open:** a build or pull that fails still leaves the box's files changed, as a plain `install` always has. Also open: the simplify review suggested `waitron.sh reset … --install [ref]` instead of `--reset … install [ref]`, reusing reset's own option reading; the form shipped is the one the owner asked for, so that is the owner's call. [Detail](backlog/box.md#what-waitronsh---reset-install-1122-left-open)

- **What showing the failed start's reason (#695) left:** [Detail](backlog/box.md#what-showing-the-failed-starts-reason-695-left)

- **The recovery spec** — a degraded-but-trading mode and the module-contract field it needs.

- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on every log line — the connection-string shape and nothing else. [Detail](backlog/box.md#the-recovery-pages-secret-bound-is-a-convention-not-a-guard)

- A `sealAeat`/`persistTrading` I/O failure AFTER `provisionVenue` succeeds wedges the box (tenant
  minted, no `trading.env`) and needs a recovery path or a loud wedge; a provision failure after
  `provision()` mints the tenant and chain needs a re-image today.

- **Resetting a box without a terminal** — owner, 2026-10-02. Wanted: a reset offered on the dashboard, and probably on the recovery page as well, because a box that will not start is the one an operator most wants to reset. Open: who may press it (the owner only?), and whether a reset started from inside the app container can remove the Docker volumes the script removes, or has to empty them instead. [Detail](backlog/box.md#resetting-a-box-without-a-terminal)

- **A box that mints its certificate before NTP sync persists a wrong validity window**, with no
  renewal path yet. Ties to a time-health check and certificate renewal.

- **Shutdown closes the database even when stopping background work fails (C71, #870)**
  (`apps/server/src/boot.ts`). One consequence: if stopping Litestream itself fails, the store is
  now closed while Litestream may still be running; nothing tests that case.

- **Two concurrent first provisions can still race past the venue guard** — 2026-09-14. **Next action:** decide where the lock belongs — a database advisory lock around guard→stamp→apply is the obvious home — and prove it with two concurrent provisions against a real database, not with the row-level check alone. [Detail](backlog/box.md#two-concurrent-first-provisions-can-still-race-past-the-venue-guard)

- **Creation/provisioning `dayCutover` still needs input validation.** The W6 review (#1104) passed `"24:00"` and `"99:99"`
  through `planVenue`; both emerged with seconds appended. **Next action:** choose the validation
  boundary and a domain refusal, then test invalid values before they reach storage.

- **#1042 needs every venue migrated before it reset** — the owner's box included (dev venues:
  `wa-wt reset demo <name>`): it changed the hashes of
  `packages/db/drizzle/0001_behavioural_triggers.sql` and
  `packages/media/drizzle/0001_image_references.sql`, so boot refuses such a venue with
  `provisioning.database_ahead`. Left open by C127 (#1036, #1042).

- **`resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged, and nothing chmods the
  staging folder** — found by #658 while pruning comments. Still open, not fixed, by the owner's
  choice: `unpackBundleToDir`'s walk and file write go by path, so a folder inside the destination
  swapped for a symlink during the unpack is followed. The restore itself (`restoreSecrets`) keeps
  none of `waitron-recovery unpack`'s destination refusals (a symbolic link, another user's folder,
  not a folder) on the state folder it is given.
  [Detail](backlog/box.md#resolvesafeentrypath-appsserversrcstate-secretsts-is-unchanged-and-nothing-chmods-the-staging-folder)

- **`apps/server/src/errors.ts` still cites CLAUDE.md §5 for things §5 does not say** — found by
  #656 while pruning comments. No production caller sets `skipSecrets` any more, so whether the
  option should go is open.
  [Detail](backlog/box.md#appsserversrcerrorsts-still-cites-claudemd-5-for-things-5-does-not-say)

- **`apps/server/README.md` (near line 230, the `WAITRON_SKIP_RETRY_MS` row) says the sleep clamp
  can round a value "past" a bound, which it cannot** — found by #653 while pruning comments. Two
  notes #653's prune deleted and nothing else recorded: nobody knows why the 5-second busy timeout
  did not absorb a `database is locked` in the pending-payment sweep; and nothing proves
  `startServer` itself survives a backup duty that cannot start — only `backup-supervisor.test.ts`
  covers that, at the supervisor.
  [Detail](backlog/box.md#appsserverreadmemd-near-line-230-the-waitron_skip_retry_ms-row-says-the-sleep-clamp-can-round-a-value-past-a-bound-which-it-cannot)

- **The empty-venue-directory reason #561 deleted from `packages/provisioning` … is false there** —
  found by #561 while pruning comments. The same reason still stands in
  `packages/provisioning/README.md` and in `docs/developers/conventions-data.md` (the paragraph on
  `resolveVenueDir`, "an empty directory is the RELATIVE `venue.db`").
  [Detail](backlog/box.md#the-empty-venue-directory-reason-561-deleted-from-packagesprovisioning--is-false-there)

- **`packages/provisioning/README.md` also says only `ES-common` is implemented** — found by #561
  while pruning comments. `docs/developers/conventions-data.md` cites
  `packages/provisioning/src/errors.ts` as spelling engine errors by `errcode`; it no longer does.
  [Detail](backlog/box.md#packagesprovisioningreadmemd-also-says-only-es-common-is-implemented)

- **`quoteIdent` has no caller outside its own suite** — found by #561 while pruning comments
  (`packages/provisioning`). The coverage config leaves `src/bin.ts` out with no reason stated any
  more, which may hide code a test could reach.
  [Detail](backlog/box.md#quoteident-has-no-caller-outside-its-own-suite)

- **On a box that holds a key while backups are off because its venue failed to open**, an apply
  that reuses the held key writes, reloads, the venue fails to open again, and the route answers
  `backup.effective_mismatch` (read from the route, not run). Left open by SQLite slice 2 Task 2a
  (#557, a recovery key that does not need an archive destination).

- **The bucket copy panel's refusal for a too-short key names the "Turn on backups" button but does
  not link or scroll to it.** Left open by SQLite slice 2 Task 2a (#557, a recovery key that does
  not need an archive destination).
  [Detail](backlog/box.md#the-bucket-copy-panels-refusal-for-a-too-short-key-names-the-turn-on-backups-button-but-does-not-link-or-scroll-to-it)

- **The status watcher does not retry its own failed mint** (the mint is a POST, never passive
  session activity), so the screen then offers no key until it is reopened. Left open by SQLite
  slice 2 Task 2a (#557, a recovery key that does not need an archive destination).

- **The edit-settings form can meet `backup.recovery_key_exists`** when a rotate (from another tab
  or admin) lands after it fetched the key. Left open by SQLite slice 2 Task 2a (#557, a recovery
  key that does not need an archive destination).

- **The owner's call: `rotate` with a destination loaded rebuilds `backup.env`** from the running
  settings rather than keeping the file's other lines, so a destination added to the file by hand
  and not yet loaded is dropped. Left open by SQLite slice 2 Task 2a (#557, a recovery key that does
  not need an archive destination).

- **From #608: the recovery level is read before `recovery.lock`,** so the pre-boot count another
  start writes can still push a server restarting at that moment onto the recovery page. Left open
  by SQLite slice 2 Task 3a (#566, one process per venue folder; #573; #608).

- **From #573's review, the owner's call: only an unwrapped `provisioning.database_in_use` is
  recognised** — a wrapped one, or the store's raw `VenueInUseError`, would still count (no path
  wraps them today). Left open by SQLite slice 2 Task 3a (#566, one process per venue folder; #573;
  #608).

- **From #608, no behaviour change decided: the watchdog appends its line to `waitron.log` without
  creating the log folder,** so on a machine with no such folder that line is lost; only a store's
  `close()` waits for the watchdog thread to end, not a bare `release()`. Left open by SQLite slice
  2 Task 3a (#566, one process per venue folder; #573; #608).

- **From #566's review: the migrator's lock and the venue lock use one technique in two copies,**
  and the test helper that holds the lock from another process is copied into several test files.
  Left open by SQLite slice 2 Task 3a (#566, one process per venue folder; #573; #608).

- **Which real providers lack S3's multi-object delete, and what each answers, is not established;**
  a provider that refuses it with a status other than 501 fails the day's prune
  (`stream.prune_failed`). `probeBucket` deletes one object at a time, so it cannot reveal such a
  provider; having it delete its test object through `deleteMany` would. Left open by SQLite slice 2
  Task 5 (#569, `@waitron/stream`).

- **Nothing in the package has been run against a real provider's bucket:** the unit tests drive the
  real S3 client over a scripted network, and the loop test drives it against versitygw. Left open
  by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

- **Every synchronous `deriveKey` caller still blocks the event loop while it derives.** Left open
  by SQLite slice 2 Task 5 (#569, `@waitron/stream`).
  [Detail](backlog/box.md#every-synchronous-derivekey-caller-still-blocks-the-event-loop-while-it-derives)

- **A pointer write from a process that has since died, landing after the restart, can still make
  the box refuse itself**, because a restarted process starts with an empty record. In both cases
  the owner's alert (`backup.stream_refused`) still says another box is writing. Left open by SQLite
  slice 2 Task 6 (#590, the Litestream supervisor).
  [Detail](backlog/box.md#a-pointer-write-from-a-process-that-has-since-died-landing-after-the-restart-can-still-make-the-box-refuse-itself)

- **The server's 8-second shutdown stops the stream last,** after the Cloud snapshot loop, so on a
  large database Litestream may not finish its last upload (it is still told to stop and does not
  outlive the server). Left open by SQLite slice 2 Task 6 (#590, the Litestream supervisor).

- **`pnpm setup:litestream` skips the download when the installed binary already reports the pinned
  version,** so the checksum protects fresh downloads only. Left open by SQLite slice 2 Task 6
  (#590, the Litestream supervisor).

- **A bucket read given up after five minutes is not cancelled,** because the bucket client's list
  takes no way to stop it; what the deadline can still leave running is a listing whose answer keeps
  arriving, or one whose answer stalls after headers that arrived within the first three seconds.
  Left open by SQLite slice 2 Task 7 (#619, how current the bucket copy is).

- **A commit that changes no row but writes to the side file,** such as a schema change or a pragma
  such as `user_version`, is not reported, so the lag can read low. Left open by SQLite slice 2 Task
  7 (#619, how current the bucket copy is).

- **An update that writes the same value, straight after a schema-only commit, is still reported,**
  although it adds nothing for the bucket (a test pins it). Left open by SQLite slice 2 Task 7
  (#619, how current the bucket copy is).

- **The check that the side file changed was measured on the Mac's filesystem only,** not the box's
  Linux one; a commit landing in the same file-time tick after a side-file restart is missed. Left
  open by SQLite slice 2 Task 7 (#619, how current the bucket copy is).

- **A sale whose write transaction began before the supervisor first subscribed after boot is not
  counted,** so the lag reads low for it. Left open by SQLite slice 2 Task 7 (#619, how current the
  bucket copy is).

- **Whether Litestream uploads anything while the side file is unchanged is not measured.** Left
  open by SQLite slice 2 Task 7 (#619, how current the bucket copy is).

- **Task 8a** (#627, the server side of the bucket-copy settings): the dead-process pointer write
  under Task 6 applies here too. Left open by SQLite slice 2.

- **Task 8b** (#628, the Backups screen's bucket-copy panel). Open: the Backups screen's own card
  width is still a `34rem` literal, which the no-hardcoded-chrome rule forbids in a view and no
  guard reads; and a change of the secret access key alone, made in another tab, still leaves the
  old kit showing, because a settings read does not carry the secret. Left open by SQLite slice 2.

- **When the key rename and the put-back both fail, the new certificate is left beside the old key**
  (the listener refuses the pair). Publishing the pair through one atomic switch (for example a
  directory swapped by a single rename) would remove this case. Left open by SQLite slice 2 Task 9a
  (#630, the first start after a restore).
  [Detail](backlog/box.md#when-the-key-rename-and-the-put-back-both-fail-the-new-certificate-is-left-beside-the-old-key)

- **A copy over 2 GiB cannot be restored**: `restoreFromStream` reads the downloaded file whole, and
  Node refuses a file that size (`ERR_FS_FILE_TOO_LARGE`). The root is that placement
  (`restoreDatabase`) takes bytes, not a file. Left open by SQLite slice 2 Task 9b (#642,
  `waitron-restore restore --from-bucket`).
  [Detail](backlog/box.md#a-copy-over-2-gib-cannot-be-restored)

- **`pragma integrity_check` is one blocking statement,** and the venue watchdog kills a process
  after 120 seconds without a timer turn. The review measured 6.0 s on a 1.36 GB database on NVMe;
  box storage has not been measured. Left open by SQLite slice 2 Task 9b (#642, `waitron-restore
  restore --from-bucket`).

- **A staged request whose marker is invalid, or whose payload cannot be read, throws before the
  request is cleared,** so every start fails the same way. I believe this predates the branch. Left
  open by SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`).

- **A copy with no `tenants` row reads an empty tax id,** which neither the command line nor the
  setup wizard ever accepts as confirmed, so it cannot be restored; no dedicated error code names
  that case. Left open by SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`).

- **An interrupted bucket rebuild or archive check leaves its scratch folder,** a full copy of the
  venue database, under the state folder; the next run makes a new one and does not remove it. Left
  open by SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`).

- **A `.venue.db-replaced-` folder left in the venue folder is removed by the box's next start**
  (`clearReplacedDatabases`, A31) only from the container's entry: a server started any other way
  (the dev stack) does not. Left open by SQLite slice 2 Task 9b (#642, `waitron-restore restore
  --from-bucket`).

- **Open question: the first start's pointer read and the bucket rebuild's calls** (the command
  line's `--from-bucket` and the wizard's `/setup-api/restore-bucket`) use different limits (15
  seconds and 60 seconds) and report different codes (`restore.pointer_unreadable` and
  `backup.stream_request_failed`). The code does not say why they differ. Left open by SQLite slice
  2 Task 9b (#642, `waitron-restore restore --from-bucket`).

- **Whether a sale's write waited behind the server's fold-back, rather than landing before it, is
  not observed,** and the fold-back of a 256 MiB file is still timed only by the bench rig (results
  note, 1b), not through the supervisor. Left open by SQLite slice 2 Task 10 (#652, the loop test
  against a real S3-compatible server).

- **Open: Litestream at trace logging deadlocked sales for five seconds.** **Next:** check whether
  any setting lets an operator raise Litestream's log level, and read the pipe on a thread that does
  not wait on the database if so. Left open by A133 (#889).
  [Detail](backlog/box.md#litestream-at-trace-logging-deadlocked-sales-for-five-seconds)

- **The bucket client's limits (A44, #676) — what is still open.** `createS3ObjectStore` gives a
  request up when it has had no reply 30 seconds after it started (`BUCKET_IDLE_MS`,
  `packages/stream/src/s3-store.ts`).
  [Detail](backlog/box.md#the-bucket-clients-limits-a44-676--what-is-still-open)

- **The wizard route answers `backup.stream_name_invalid` 400, where other bucket failures answer
  502** — the status table in `apps/server/src/setup-api.ts` maps the code as one, and the same code
  also covers a bad value in the recovery kit, where 400 is right. Left open by #668, #686, A57, A60
  and #723 (the pause test and the bucket's error reports).

- **A batch delete's `backup.stream_request_failed` still carries the file's name as the bucket
  listed it in `key`** (the `deleteMany` refusal in `packages/stream/src/s3-store.ts`); that the
  prune logger drops it is a review seat's reading and one run, not a guard. Left open by #668,
  #686, A57, A60 and #723 (the pause test and the bucket's error reports).

- **That a real bucket's 403 to the pause's listing reads that code, and the status and `errorName`
  on each line, were shown by reading**, by the store's scripted HTTP answers and by the
  supervisor's injected errors, not against a real bucket. Left open by #668, #686, A57, A60 and
  #723 (the pause test and the bucket's error reports).
  [Detail](backlog/box.md#that-a-real-buckets-403-to-the-pauses-listing-reads-that-code-and-the-status-and-errorname-on-each-line-were-shown-by-reading)

- **A venue preparing to go live sends real email through SMTP (owner 2026-10-03) — OPEN.** "Later
  prepare should use a real SMTP server": a prepare venue would send invitations and password resets
  through SMTP instead of capturing them on the box, and the top bar's inbox link (A227) would become
  demo-only again. Not built.
  [Detail](backlog/box.md#a-venue-preparing-to-go-live-sends-real-email-through-smtp-owner-2026-10-03--open)

- **Reset pre-production venues before using W53 with orders recorded before this migration** —
  left open by W53 (#1152); otherwise their live tickets and settled reprints can show the old unit
  wording.

- **Reset retained pre-live venues before installing core `0092`, which rebuilds both tables** —
  left open by W52 (#1170).

- **Installing W98 needs every populated venue reset** — left open by A204's W98 (#1331): it drops
  `zone_menus` and rebuilds `zone_service_policies`, and nothing carries the old per-zone menus
  across. The shared dev venue was reset when it landed (2026-10-07); the owner's box needs a reset
  too.

- **A blank "Time of day" on the backup screen sends `{ hour: 0, minute: NaN }`** — left open by
  A178 (#1010 to #1019), seen while building, not changed: the same parsing is on `main` before
  A178b (`#buildSchedule`'s `split(":")`); what the server does with it was not checked.

### Replication, failover and the cloud

_Formerly _Afterwards_ and _Cloud connection integration_._ Detail: [backlog/replication-cloud.md](backlog/replication-cloud.md).

Not in any track until the standalone primary is done.

- **A completed provision or adopt operation replayed on a later request still answers 200 without
  restarting and keeps the setup lock set** — found by #657 while pruning comments. After a refused
  resend of a half-finished adopt (A50, #685), what the first identity leaves behind on the primary
  and on this node is still not measured. The standby's reset page does not show this server's
  machine id, so an operator cannot tell which row on the primary's Servers screen is this server's
  (left for the owner from A70's review).
  [Detail](backlog/replication-cloud.md#a-completed-provision-or-adopt-operation-replayed-on-a-later-request-still-answers-200-without-restarting-and-keeps-the-setup-lock-set)

- **`docs/developers/conventions-data.md`'s `busy_timeout` receipt … should carry the date and Node
  version the deleted comment had** — found by #625 while pruning comments. `adoptFromPrimary`
  (`adopt.ts`) spreads one adoption across several transactions with file writes between and no
  commented decision (CLAUDE.md §3), so a failure partway could leave a stamped mirror with no
  break-glass verifier.
  [Detail](backlog/replication-cloud.md#docsdevelopersconventions-datamds-busy_timeout-receipt--should-carry-the-date-and-node-version-the-deleted-comment-had)

- **The boot-time fetch is given only the URL … and boot never reads the `superseded` that
  `reconcileMembershipOnBoot` returns** — found by #617 while pruning comments. `shouldFenceRestart`
  (`membership-fence.ts`) has no caller outside its test (`git grep`). `setup-operation.ts` (around
  lines 128–133) may treat a lock written by a different store as a previous boot's, so a live
  process's lock could be taken over (a belief, not verified).
  [Detail](backlog/replication-cloud.md#the-boot-time-fetch-is-given-only-the-url--and-boot-never-reads-the-superseded-that-reconcilemembershiponboot-returns)

- **The tunnel's stand-in relay pairs with sockets that have already gone** — OPEN (found
  2026-09-23, writing tunnel's coverage tests, PR #506). `packages/tunnel/src/testing/relay.ts` is
  test-only: nothing outside `packages/tunnel`'s own suites imports it, and Waitron ships no relay.
  When a parked box closes, it stays in `idle` until a client takes it, so the next client is paired
  with the dead box and its bytes go nowhere (both reviewers of that branch ran this).
  [Detail](backlog/replication-cloud.md#the-tunnels-stand-in-relay-pairs-with-sockets-that-have-already-gone)

**The on-prem mirror.** Read this section as requirements slices 3–5 must meet, not as work
outstanding on code that exists. The membership, promotion and rejoin arc (#197–#272) is still in
the tree. What remains, largest first:

- **Status, alarms and the operator surface for replication.** An operator needs to see whether the
  standby is keeping up, and to be alarmed when it is not.

- **Fiscal-certificate distribution** — rebuild on the asynchronous adopt (see the residuals). Open
  design question: how the dormant certificate is protected when the seal must happen after the
  initial copy. Beside it, **the vault-ring question**: `tenant_credentials` is `local` and a blob
  sealed under one node's ring cannot be opened under another's, so `fiscal.aeat` and
  `payments.stripe` do not travel to a standby at all.
  [Detail](backlog/replication-cloud.md#fiscal-certificate-distribution)

- **Node-role collapse** — derive ONE `NodeRole` at boot from the membership document and pick one
  rule: every role change is a restart, or the worker-lifecycle manager — not both.

- **The mirror as a backup destination**, and the mirror's print agent (gated on B6's cross-box
  TLS).

- **Adding a mirror while the internet is down** (owner, 2026-10-02). So with the internet down
  there is no way to add a mirror, which is the very case an on-prem mirror exists for. Wanted: a
  new mirror takes its first copy straight from the primary over the LAN. Slice 5 should name this
  as the way a mirror is added and prove it with the internet unplugged.
  [Detail](backlog/replication-cloud.md#adding-a-mirror-while-the-internet-is-down)

- **The two-node end-to-end proof over LAN and over WireGuard**, including the same-site cookie
  browser receipt still owed from the till reroute, #257 (needs interactive Chrome + mkcert +
  `/etc/hosts`).

- **Richer daily close** — one close run by the primary across all tills.

- **Replication, membership & failover — residuals** — **Until slice 3 a venue has ONE node and no
  failover at all.** Read the residuals as requirements for what failover is rebuilt INTO, not as
  descriptions of code that exists today. Open: a cut-off primary keeps streaming, into its own copy
  (owner, 2026-09-24); a standby checks a promotion against the primary's key (owner, 2026-09-26);
  `retireSelf` and `rejoinAsSecondary` lost their drain confirmations; `rejoin --accept-loss` waives
  nothing today; an adopted mirror can no longer leave adoption-pending; re-admission, the
  membership chart filling up, chart hygiene, the resume-at-restore marker, the worker-lifecycle
  manager, power-loss durability and the selling gate, getting the AEAT certificate onto a promoted
  standby, restore-onto-cloud re-encrypt, the carry-ins, mirror fidelity, split-brain on the
  promoted side, the till UX for a timed-out card.
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

- **A stale worktree:** `feat/h2-fiscal-record-sync` (spec and plan dated 2026-09-04, uncommitted
  changes in `packages/sync`) was designed on the application outbox that #280 deleted, and the
  replication it was rewritten against went too; the `ledger` classification of the fiscal tables
  survives both. Remove it once the owner confirms nothing in its uncommitted diff is wanted.

**Cloud integration and SQLite work.**

- **Customer remote setup UI and production deployment remain open.** Left open by the Cloud
  connection integration (2026-09-24; #638, #808).

- **Shutdown waits for an in-progress local database copy or encryption step.** Next: measure that
  shutdown latency, real venue uplink budgets and spool disk use, and stream archive assembly beyond
  its current in-memory 512 MiB format limit. Cloud documentation: `docs/authenticated-captures.md`
  in waitron-cloud. Left open by the Cloud connection integration (2026-09-24; #638, #808).

- **After a Cloud replacement (#638), installing the new tunnel and TLS certificate remains an
  operator step.** Continuous complete-server recovery, planned final-write handover and production
  recovery remain open. Cloud owns route placement and fencing in its backlog. Left open by the
  Cloud connection integration (2026-09-24; #638, #808).

- **A stop made while `cloud-replacement.json` is unreadable is not recorded in it.** Owner to
  choose: refuse Stop access while the replacement file is unreadable, or record the stop somewhere
  that survives the repair. Left open by the Cloud connection integration (2026-09-24; #638, #808).
  [Detail](backlog/replication-cloud.md#a-stop-made-while-cloud-replacementjson-is-unreadable-is-not-recorded-in-it)

- **The Litestream stream's sealed-state restore and activation still need integration with Cloud
  storage and owner recovery.** Connected does not mean those services are configured. Cloud service
  ownership stays in the Cloud backlog; this repository owns its adapter, screen and node-side
  behavior. Public hosting, ingress controls and Cloud audit/retention remain deployment work. Left
  open by the Cloud connection integration (2026-09-24; #638, #808).

- **Observations are synthetic until service adapters exist.** Left open by the Cloud connection
  integration (2026-09-24; #638, #808).

- **Waitron retains:** the implemented Cloud connection screen and manager adapter; box-side
  networking and `@waitron/tunnel`'s retirement; first-contact trust bootstrap; and the
  cloud-standby end-to-end proof. **Do not restart the cloud-standby work until the
  Waitron↔Waitron-Cloud boundary contract is settled.**
  [Detail](backlog/replication-cloud.md#waitron-retains)

- **SQLite + Litestream replaces PostgreSQL** (owner decision 2026-09-16). **Next: slice 3, seats
  and promotion. Its first task is already decided: credentials move to a venue key** stored in
  `venue.db` only in locked form — do not reopen it.
  [Detail](backlog/replication-cloud.md#sqlite--litestream-replaces-postgresql)

- **Validate every supported object store.** Topology §12.2's real-store gate remains open; the
  conditional-write promotion tie-break must be demonstrated on each target (risk 11). Waitron
  Cloud's production store still needs its own run. Left open by the SQLite failover-loop prototype
  gate (#425; receipts in [the results note](research/2026-09-16-sqlite-failover-prototype.md)).
  [Detail](backlog/replication-cloud.md#validate-every-supported-object-store)

- **The store pointer and a new generation are exercised for a rebuild, not for a promotion.** A
  promoted node's generation, and Cloud's recovery orchestration (tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)), remain;
  settle the Waitron ↔ Waitron Cloud contract before assigning them. Left open by the SQLite
  failover-loop prototype gate (#425; receipts in
  [the results note](research/2026-09-16-sqlite-failover-prototype.md)).

- **250 sales a day is still an assumption** nothing in this repository measures, so the
  days-per-GiB figure rescales but does not hold. Left open by the SQLite failover-loop prototype
  gate (#425; receipts in [the results note](research/2026-09-16-sqlite-failover-prototype.md)).

- **Three scenarios have no mutation receipts (S1, S6, `smoke`), two branches of the litestream
  wrapper are driven by no scenario, and the runner's own `main()` is undriven** — a later task
  should pin them or delete them. Left open by the SQLite failover-loop prototype gate (#425;
  receipts in [the results note](research/2026-09-16-sqlite-failover-prototype.md)).

- **Task 1a** (#548, each machine's own rows keyed by its node id). Deny's delete is the one
  join-request node filter no test fails without (the `requirePending` read before it already
  refuses another node's row); and the run-it review did not reach three claims within its budget —
  holders torn by a concurrent promotion, credential sealing, and scheduler takeover. Left open by
  SQLite slice 2.

- **A node row holding no endorsement still signs `endorsements: []`, and no first-start case
  asserts it.** Left open by SQLite slice 2 Task 9a (#630, the first start after a restore).

- **Two comments claim more than the code keeps.** Narrow both the next time either file is edited.
  Left open by SQLite slice 2 Task 9a (#630, the first start after a restore).
  [Detail](backlog/replication-cloud.md#two-comments-claim-more-than-the-code-keeps)

- **A restored box whose cloud peer does not answer during its first start signs the next term and
  removes the marker**; a fencing document the peer serves later at that same term reads as not
  newer, so the box is never fenced (reproduced with a temporary two-boot case in
  `apps/server/src/boot.reconcile.test.ts`). Recorded, not redesigned. Left open by SQLite slice 2
  Task 9a (#630, the first start after a restore).
  [Detail](backlog/replication-cloud.md#a-restored-box-whose-cloud-peer-does-not-answer-during-its-first-start-signs-the-next-term-and-removes-the-marker)

- **The pointer read gives up after 15 seconds but does not cancel the request:** the bucket
  interface takes no way to stop one. Left open by SQLite slice 2 Task 9a (#630, the first start
  after a restore).

- **The pointer's term is taken without checking its signature,** as the supervisor already does, so
  whoever can write the bucket can push a restored box's term up (never down). Left open by SQLite
  slice 2 Task 9a (#630, the first start after a restore).

- **A marker left on a fenced box survives `waitron-rejoin`,** which wipes the database and removes
  only `trading.env` from the state folder (`apps/server/src/rejoin-command.ts`), so the first start
  runs whenever that box next starts trading unfenced and not as a mirror. Whether a rejoin should
  clear it is the owner's call. Left open by SQLite slice 2 Task 9a (#630, the first start after a
  restore).

- **A sell-only local secondary that is not fenced runs the first start and signs the next term.**
  Left open by SQLite slice 2 Task 9a (#630, the first start after a restore).

- **The restored membership row's check (`assertRestoredMembershipValid`, #678) trusts the keys the
  restored copy holds.** Left open by SQLite slice 2 Task 9a (#630, the first start after a
  restore).
  [Detail](backlog/replication-cloud.md#the-restored-membership-rows-check-assertrestoredmembershipvalid-678-trusts-the-keys-the-restored-copy-holds)

- **Only the start that finishes a restore checks the row's signature.** A mirror or fenced start
  checks only that it can be read and is shaped as a document (A53); a start still finishing an
  adoption checks neither. Left open by SQLite slice 2 Task 9a (#630, the first start after a
  restore).
  [Detail](backlog/replication-cloud.md#only-the-start-that-finishes-a-restore-checks-the-rows-signature)

- **On a start with NO restore marker, text that is not JSON or a machine list that is not a list
  fails with the generic text.** Whether to give it a curated code is open. Left open by SQLite
  slice 2 Task 9a (#630, the first start after a restore).
  [Detail](backlog/replication-cloud.md#on-a-start-with-no-restore-marker-text-that-is-not-json-or-a-machine-list-that-is-not-a-list-fails-with-the-generic-text)

- **A mirror that deferred its first start and is then promoted without a restart**
  (`promoteMirrorToPrimary`) keeps the bucket copy held, reading off with the reason
  `first_start_pending` and raising no alert, until the box next starts. From reading, not a run.
  Left open by SQLite slice 2 Task 9a (#630, the first start after a restore).

- **If a later slice moves `local` tables into `node.db`** (slice 2's design reserved it for slice
  5), that slice decides again how the drain crosses the two files: SQLite refuses a trigger body
  that writes another attached database, so either `change_log` is reclassified to the file its
  writers live on, or the triggers stop writing it directly and something above them does (P3). Left
  open by SQLite slice 1 (#490 and the preparation tasks).

### CI, tests and developer tooling

- **A419 dashboard CI stall remains unexplained (#1474).** Run `37932573955` left
  `catalogue-screen.test.ts` unfinished; local focused and full-package runs and diagnostic
  CI `37936013331` completed. No repair was established. Next: if it recurs, retain per-test
  progress and locate the waiting operation before changing the browser harness.

_Formerly B9, and the old Track C's development-stack and house-rules items; part of A9._ Detail: [backlog/ci.md](backlog/ci.md).

- **A dev venue built before A230 keeps the tax ID `50000000K`**, whose sales 0.2.1 refuses;
  `wa-wt reset demo <name>` rebuilds it as the demo business, tax ID `B00000000` (W108). Left open by A230 (`@waitron/verifactu` 0.2.1, #1099).

- **Test-helper debt:** `provisionTestVenue(db, overrides)` for `apps/server`'s sixty-odd suites; the
  duplicated `boot.*.test.ts` helpers into `apps/server/src/testing/` (`freePort` has moved there,
  A80; the rest remain); a shared `useFiscalMirrorPair()` for the two-clone fiscal suites.

- **Both image jobs still run `docker/setup-buildx-action`**, whose only stated reason was the
  cache export #1427 removed. Whether the builds still need it (for example for `load: true` or the
  print-agent build reusing the app build's layers) was not tried. Left open by A399 (#1427); no
  action queued.

- **A new branch pushed while the refresh fails still has its range start at the local
  `origin/main`'s merge base** — left open by the pre-push hook's sign-off fixes, A392 (#1421) and
  A411 (#1445), after which the hook refreshes `origin/main` from the remote first; no action
  queued.

- **The stream pause test's frozen-bucket control failed once in CI (PR #1101, run 37108993254
  attempt 1, job 111163230954, 2026-10-03; passed on re-run).** The original one-off race has not
  been reproduced locally. If the control fails again, retain that run's log and inspect the child
  state before naming another cause. [Detail](backlog/ci.md#the-stream-pause-tests-frozen-bucket-control-failed-once-in-ci)

- **What the stream pause test's last-restore fix (A387, #1398) left open:** a local Linux run
  keeps the machine's own loopback and can still meet the stall (how often was not measured), and a
  box's restore over a real network was not measured.

- **What moving the upgrade test's scratch directory to `/dev/shm` (A122, #856) left open:**
  `scratchParent()` does not fall back to the disk when `/dev/shm` is nearly full, and on CI's Linux
  runner `scripts/scratch-dir.mjs` measures 83% of branches. Neither is queued. [Detail](backlog/ci.md#what-moving-the-upgrade-tests-scratch-directory-to-devshm-a122-856-left-open)

- **Would the package suites' databases gain from memory too?** Not measured for them. Next
  action: time one database-heavy package's `test:coverage` in CI with its folders on the disk and
  under `/dev/shm`, and adopt it in `useVenueDb` only if the shard times move and a suite's
  databases fit in `/dev/shm` (Docker's default is 64 MiB). [Detail](backlog/ci.md#would-the-package-suites-databases-gain-from-memory-too)

- **What the landing-port fix (A80, PR #740) left open:** `freePorts(n)` holds every probe until
  the last port is drawn, but a port is still released before the server binds it, so another test
  worker drawing or connecting in that gap can take it; nothing has measured how often.
  [Detail](backlog/ci.md#what-the-landing-port-fix-a80-pr-740-left-open)

- **`bundle-smoke` builds only the credentials and server bundles**, so a change to
  `scripts/bundle-node.mjs` selects print-agent and provisioning for typecheck and tests (#593,
  through `ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs`) but builds neither of their bundles
  in CI.

- **The table-service, boot-and-counter and three `tender-pay-*` suites are separate files** that
  can be folded back into `till-app.test.ts` and `tender-pay.test.ts` once `feat/variants-sale-line`
  lands. Left open by `apps/till`'s move to the high coverage bar (#536).

- **Nobody has timed `packages/db/src/testing/schema-conformance.ts` under a mutation run — OPEN
  (2026-09-23).** **The new file's runtime was not measured and no `HEAVY_FILES` entry was added**,
  so whether it drags a job out the way `sales.ts` did is unknown. **Next action:** read the job
  durations from the next weekly run, and add a `HEAVY_FILES` entry if that file's job is the long
  one. [Detail](backlog/ci.md#nobody-has-timed-packagesdbsrctestingschema-conformancets-under-a-mutation-run)

- **The spawn-timeout guard compares a bound against the LARGEST SINGLE wait, never the sum — OPEN,
  and the guard cannot close it.** A case that waits several times can still outlast a bound that
  passes this check. [Detail](backlog/ci.md#the-spawn-timeout-guard-compares-a-bound-against-the-largest-single-wait-never-the-sum)

- **What the per-push CI concurrency groups (#384) left open:** two states stop publishing until a
  person intervenes; the repair is to delete or retag `:main` by hand. Nothing alerts on it. [Detail](backlog/ci.md#what-the-per-push-ci-concurrency-groups-384-left-open)

- **Three unexplained incidents, each seen once or twice; on recurrence retain the log before
  retrying** (standing rule: a flaky test is fixed at the root). The original log and screenshot were
  kept; the cause is unexplained, so retain them again on the next sighting rather than re-running to
  green. [Detail](backlog/ci.md#three-unexplained-incidents-each-seen-once-or-twice-on-recurrence-retain-the-log-before-retrying)

- **A fifth: a stray `:hover` state in `test-dashboard`'s browser a11y suite — FIXED in #350; two
  pieces still open.** The `dashboard-app.a11y.test.ts` heading-order sighting is a different rule
  with no colour evidence, so nothing here explains it — treat it as still unexplained. And
  `packages/ui` and `apps/till` have the same harness with no pointer reset, so the same flake is
  waiting there. [Detail](backlog/ci.md#a-fifth-a-stray-hover-state-in-test-dashboards-browser-a11y-suite)

- **A sixth: a CI shard exited 1 with every test passing (PR #414) — the exit-1 path closed by the
  Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.** Keep the job log on the
  next sighting — it is the cheapest evidence there is. [Detail](backlog/ci.md#a-sixth-a-ci-shard-exited-1-with-every-test-passing-pr-414)

- **Whether to add a browser rule to `pnpm reap` anyway, for a shape not observed** — owner
  question, left open by A426 (owner 2026-10-08; measured, no code change). It would have to tell a
  test browser from the Playwright MCP's `mcp-chrome-*` browser, which lives under the same
  `ms-playwright` cache folder.

- **`bench/pglite-throughput` starts a container `pnpm reap` cannot see — OPEN (T2, 2026-09-23).**
  Either stamp the label in that rig or accept cleaning it by hand — but the rig's schema is three
  storage decisions out of date anyway (its own entry, _The PGlite throughput bench no longer matches the shape it says it matches_), so the two decisions belong
  together. [Detail](backlog/ci.md#benchpglite-throughput-starts-a-container-pnpm-reap-cannot-see)

- **A throwaway script found six comments that described code that was no longer there, and it is
  not a guard yet** (written 2026-09-14 during the tenant-column removal). **Next action:** rewrite it
  as a real root guard with an allowlist for that header-then-member shape, and its own tests, rather
  than re-running a scratch script. [Detail](backlog/ci.md#a-throwaway-script-found-six-comments-that-described-code-that-was-no-longer-there-and-it-is-not-a-guard-yet)

- **`apps/server/src/boot.mirror.test.ts`'s adoption-pending case no longer has a negative
  control.** **Next action:** find a failure the empty database still causes without the guard, and
  name it; if there is none, say so in the comment and stop calling the case a guard test.
  [Detail](backlog/ci.md#appsserversrcbootmirrortesttss-adoption-pending-case-no-longer-has-a-negative-control)

- _Small:_ `test-light` reports success without naming what it ran; `packages/ui` can hang the `test-ui` shard, cause unconfirmed; the classifier's `root=`
  output line is read by no consumer.

- **Two `health.test.ts` cases … feed a clean pass, so they check less than their titles say** —
  found by #624 while pruning comments.
  [Detail](backlog/ci.md#two-healthtestts-cases--feed-a-clean-pass-so-they-check-less-than-their-titles-say)

- **The venue-service `migrations.test.ts` case titled "… or at commit" asserts no refusal at
  commit** — found by #611 while pruning comments. A commit-time case, and the title, are a test
  change.
  [Detail](backlog/ci.md#the-venue-service-migrationstestts-case-titled--or-at-commit-asserts-no-refusal-at-commit)

- **`.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in
  `.husky/pre-push` beside the same loop; it is not there** — found by #602 while pruning comments.
  [Detail](backlog/ci.md#githubworkflowsciyml-about-line-283-says-the-three-shell-receipt-sits-in-huskypre-push-beside-the-same-loop-it-is-not-there)

- **The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was
  measured false** — found by #562 and #585 while pruning comments. Four identity schema files and
  six in `packages/fiscal-verifactu/src/schema` keep the ignore pairs with no reason; removing a
  pair is a code change, for whoever next changes that package's code.
  [Detail](backlog/ci.md#the-v8-ignore-reason-never-run-by-vitest-run-on-schema-files-extra-config-functions-was-measured-false)

- **The `schema-conformance.test.ts` headers of `payments`, `workforce`, `media` and `workforce-es`
  say an unnamed unique constraint reaches the factory's refusal**; drizzle-orm 0.45.2 names an
  unnamed `unique()` itself, so nothing reaches it
  (`packages/db/src/testing/schema-conformance.ts`). Found while pruning comments.

- **`packages/db/src/schema/columns.test.ts` still imports `../index.js` and `./drawer-opens.js`
  dynamically**; the comment #585 deleted was the only note that this was meant to be temporary, so
  making them static imports is a small code follow-up. Found by #585's review in files outside
  `packages/db/src/schema`, not changed there.

- **In `packages/db/src/change-log.test.ts` the case under "THIS CASE NO LONGER SEPARATES ANYTHING"
  repeats the first case under another name** (a test change, not a comment one). Found by #589
  (`packages/db` outside `src/schema`), not changed.

- **One test title in `packages/layouts/src/canvas-store.db.test.ts` (line 144) still quotes
  PostgreSQL's error number 23001** — found by #588 while pruning comments. Both layouts database
  suites create a manager session in `beforeAll`, while `useVenueDb` empties every data table after
  each test by default (`resetPerTest`, `packages/db/src/testing/venue-db.ts`), so only a suite's
  first test can use that session; they pass today because only the first does.
  [Detail](backlog/ci.md#one-test-title-in-packageslayoutssrccanvas-storedbtestts-line-144-still-quotes-postgresqls-error-number-23001)

- **`--no-verify`: the docs say "Claude never", the hook says "agents never"** — OWNER'S CALL (found
  2026-10-03 by #1139's review). **Next action:** the owner decides whether the rule covers every
  agent, then the two docs follow.
  [Detail](backlog/ci.md#--no-verify-the-docs-say-claude-never-the-hook-says-agents-never)

- **The shard layout was measured against an engine that is gone** — OPEN (found 2026-09-23, task
  F1's review wave). Read the next weekly run's shard durations before treating any of them as
  current. No local command produces the numbers, so re-cutting the matrix has to wait for a real
  weekly run. [Detail](backlog/ci.md#the-shard-layout-was-measured-against-an-engine-that-is-gone)

- **The PGlite throughput bench no longer matches the shape it says it matches** — OPEN (found
  2026-09-21, task P6). Either bring the three decisions across and re-baseline, or change the
  sentence to say what it is.
  [Detail](backlog/ci.md#the-pglite-throughput-bench-no-longer-matches-the-shape-it-says-it-matches)

- **The gate never runs on a pull request, so thinning a `packages/db` test merges green** — left
  behind by gating `packages/db`'s mutation score (#472, 2026-09-20). Either accept the weekly lag
  and say so where a reader meets the gate, or find a cheaper per-pull-request signal.
  [Detail](backlog/ci.md#the-gate-never-runs-on-a-pull-request-so-thinning-a-packagesdb-test-merges-green)

- **`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests** — left behind by raising
  the `packages/ui` mutation score (#466, 2026-09-20). Adding a fourth exclusion is the consistent
  move and also shrinks the denominator the `break: 90` is measured against. Owner's call.
  [Detail](backlog/ci.md#packagesuisrcvitest-park-pointerts-is-mutated-and-has-no-tests)

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI** — left
  behind by the vite 8 upgrade (#450, 2026-09-19). `bundle-smoke` builds esbuild bundles only. This
  is the work item `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` point at.
  [Detail](backlog/ci.md#a-pull-request-that-changes-only-front-end-code-gets-no-spa-bundle-built-anywhere-in-ci)

- **The hint's cover stops at the migration run, and provisioning runs after it** (#343). A module's
  provisioning seat (`packages/catalogue/src/provisioning.ts` seeds units) executes once migrations
  succeed, outside `withDevMigrationHint`, so a seeding failure there on a stale database gets no
  curated line. Nobody has hit this.

- **Read the first weekly mutation results for both UI packages after the split**; the split
  preserved the 90% gates but did not measure their new full mutation scores. Left open by the
  shared account controls (`@waitron/ui-core` owns the seven account controls).

- **`apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe** (its
  fixture closes the handles first, which removes the sidecars). The wipe's sidecar removal is
  pinned by `apps/server/src/db-wipe.test.ts`; what is missing is a rejoin-level case with sidecars
  on disk. Left open by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

- **`scripts/changed-packages.mjs runnable` runs before the tests in many packages' jobs, fed from a
  pipe, so the selection guard does not count it and a change to it alone runs none of those jobs.**
  Listing it against every member those jobs test would send every change to it through all of them
  — the owner's call. Left open by SQLite slice 2 Task 10 (#652, the loop test against a real
  S3-compatible server).

- **The S3 test server's ports (C88, #920).** Fixed in the harness; the mechanism is in
  [testing-guide.md](developers/testing-guide.md), "The S3 test server knows its own server". Left:
  the Waitron servers' own ports in the loop and pause tests are drawn the same way, and a lost one
  fails the boot loudly (`server.listen_failed`) rather than silently; not changed.

- **Why the side file's growth per sale differs so much between runs is not tested.** If the test
  turns unreliable on CI, that margin is where to look. Left open by #668, #686, A57, A60 and #723
  (the pause test and the bucket's error reports).
  [Detail](backlog/ci.md#why-the-side-files-growth-per-sale-differs-so-much-between-runs-is-not-tested)

- **The case "refused while the run is stopping" catches a removed stop check only through the order
  two pending steps finish in,** so re-run that removal if `#bucketAnswers` is restructured. Left
  open by #668, #686, A57, A60 and #723 (the pause test and the bucket's error reports).

- **Every `maxWorkers: 1` config whose comment gives the coverage reason**, apart from `payments`,
  which carries its own measurement, still says the pin is needed without having measured it; the
  same one-worker-against-several coverage comparison would settle each. Left open by SQLite slice 1
  (#490 and the preparation tasks).

- **P7's leftovers (#533):** `no-tenant-column`'s SQL check still passed with one set's SQL dropped,
  because it checks for an absence and the remaining files clear its floor of eight. Left open by
  SQLite slice 1 (#490 and the preparation tasks).
  [Detail](backlog/ci.md#p7s-leftovers-533)

- **A few suites still build engine-shaped refusals by hand** rather than through `refusalError`
  (`packages/db/src/testing/refusals.ts`, P10, #527), among them
  `packages/provisioning/src/cli.test.ts` and `packages/scheduler/src/store.concurrency.test.ts`.
  Left open by SQLite slice 1 (#490 and the preparation tasks).

- **After the onboarding wizard provisions, the stack started by `wa-wt onboarding <worktree>`
  restarted into setup mode**, because the dev launcher (`apps/server/scripts/dev-server.mjs`)
  looked for `trading.env` only in the state folder `apps/server/.env` names, not the one `wa-wt`
  passes; the look worked round it with links. Seen during #1320's and #1322's looks (2026-10-07,
  not checked against `main`).
  [Detail](backlog/ci.md#the-dev-launcher-looks-for-tradingenv-only-in-the-state-folder-appsserverenv-names)

- **Cross-app links in the split Vite dev stack — OPEN, unqueued.** The deployed server serves both
  apps on one origin, but the dev stack runs the till on port 5190 and the dashboard on 5191. Make
  cross-app links reach the other dev server without changing their deployed same-origin paths; this
  also affects setup's existing links.
  [Detail](backlog/ci.md#cross-app-links-in-the-split-vite-dev-stack)

- **A case in `apps/dashboard/src/screens/catalogue-screen.test.ts` (near line 2135, added by #1087
  before W92) prints "[Unhandled rejection] Error: marker" in passing runs**; the noise should go.
  Left open by W92 (#1250).

- **Some dashboard pixel and drag cases W92 did not change failed once when run in parallel
  locally** during the branch's work; the cause was not found. They passed in the PR's dashboard CI
  shard on its final head. Left open by W92 (#1250).

- **The guard W72d added (`scripts/id-columns-are-references.test.ts`) knows an id column only by
  its name**, so a reference named otherwise is still unseen. Left open by W72d (#1238).

- **W72h (#1247) stopped Chromium logging "ResizeObserver loop completed with undelivered
  notifications" from the Products tree's category name box.** A261-3 (2026-10-05) and A349
  (2026-10-08) then saw the message in other dashboard suites, on their own candidates and on the
  commits before them; that comparison does not establish which observer causes it or its effect on
  the rendered screen. A407 (#1432) later recorded: "The original-main catalogue-only command passed
  270 cases without the warning; its historical occurrence was not reproduced and is not attributed
  to currency fields."
  [Detail](backlog/catalogue.md#catalogue-no-two-categories-with-one-parent-and-no-two-active-products-share-a-name-w72-to-w72h-left-open)

- **Two till tests wait a fixed real time for a resend to give up** (found 2026-09-30, B13). **Next
  action:** run that pause on fake timers, as the lost-reply case in `till-app-drafts.test.ts`'s "a
  Send the session outlives" does.
  [Detail](backlog/ci.md#two-till-tests-wait-a-fixed-real-time-for-a-resend-to-give-up)

- **`pressEscape` in `packages/ui/src/components/wt-dialog.test.ts` waits a fixed 50 ms after each
  Escape.** **Next action:** decide whether "closes on a real Escape press" should wait for its
  `wt-close` instead, keeping the timer for the stays-open tests. Left open by service Task 11
  (#916). [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **`scripts/dashboard-browser-purity.test.ts` reads only bookings' and adjustments' dashboard
  folders, so nothing checks that venue-service's dashboard code stays free of server imports** —
  left open by the reviews of A261 step 5 (Hours, #1298).

- **Task 2's review found no test that fails when `device_profile_admission_roles` or
  `device_profile_admission_persons` is left out of
  `apps/server/src/testing/clear-provision-fixture.ts`** (read, not run); both tables' keys into
  `device_profiles` cascade on delete (identity `0007_profile_admission.sql`). Left open by W97
  (#1311).

- **The payments test "refreshes only active reader statuses" failed once locally beside another
  coverage run**, then passed five times alone and in CI; not investigated. Left open by W100
  (#1332).

- **The test-shape half of #339's lesson is unwritten.** #339 passed review and CI and the first
  person to open the screen got a 500; the "open it and look" half is CLAUDE.md §4's rule. The
  other half — a matrix that varies two things separately and never crosses them proves less than
  it looks — wants its own line. Left open by content languages and the image library (#339).

- **A two-transaction concurrency test that starts both sides in sequence is racing itself.**
  Nothing guards the shape; look for it in any new racing test.

- **A trap not yet in `CLAUDE.md`: `pnpm --filter <pkg> test <file> -t "name"` silently drops the
  `-t` and runs the whole file**; only a bare `--` before it passes it through. **Next action:** add
  it to `CLAUDE.md` §2's trap list, through the normal pull request flow.

- **`menus-screen.test.ts` writes screenshots into `apps/dashboard/src/screens/.superpowers/` on
  every run** (ignored by git, but in the source tree), the shape A281 fixed for the kitchen screen.
  Predates A348 (`git blame`: W95, 2026-10-06). Left open by A346 + A348 (#1408).

- **Update the root null-exception rule after W54 — OPEN (owner rule-file maintenance).**
  `CLAUDE.md` §3 still names only `maxPicks` and `guestCount` as fields where explicit null is a
  value. An item's `maxQuantity` is now another; `packages/catalogue/src/extra-contract.test.ts`
  pins both its absent default and explicit null. Lane D RUNNER §7 bars this campaign from editing
  the rule file.
  [Detail](backlog/ci.md#update-the-root-null-exception-rule-after-w54)

### Dependency upgrades

_Formerly parts of B9 and Track C._ Detail: [backlog/dependencies.md](backlog/dependencies.md).

- **Whether the Dependabot `vitest` group's Vitest 5 PR obeys the stored `@vitest/browser-playwright`
  5.x ignore is untested** — left open by Dependabot's switch-on (#760, 2026-09-27). A `vitest` group
  moves `vitest` and `@vitest/*` together, majors included; closing #766 stored an ignore of
  `@vitest/browser-playwright` 5.x, and whether the group's Vitest 5 PR obeys it is untested (how to
  check and clear it: workflow-guide → Dependabot pull requests); such a PR also has to re-measure
  mutation first (the entry below, _A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it_).

- **Open Dependabot pull requests — low priority, not queued (owner, 2026-10-08: take them from here
  when a lane has room).** #1179 (Vitest 5) waits on Stryker (owner). The rest: **sharp 0.35.5
  (#1299 root, #1423 `apps/server`) and the compose group (#1178)**; **the npm minor-and-patch group
  (#1267, 13 updates)**; **stripe 22.6.2 → 23.0.0 (#1181, a major)**. [Detail](backlog/dependencies.md#open-dependabot-pull-requests)

- **Comments and docs still name drizzle-orm 0.45.2; 0.45.3 is installed** — OPEN (found 2026-10-03
  by #1139's review). **Next action:** read each claim against the installed 0.45.3, then update the
  number or the claim.
  [Detail](backlog/dependencies.md#comments-and-docs-still-name-drizzle-orm-0452-0453-is-installed)

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7** —
  left behind by the TypeScript 7 upgrade (#460, 2026-09-20). When a release supports it, the root
  entry goes back to a plain `^7` range and the alias disappears.
  [Detail](backlog/dependencies.md#collapse-the-two-typescript-entries-back-into-one-once-typescript-eslint-supports-version-7)

- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it** — left
  behind by the Stryker upgrade (#447, 2026-09-19). Stryker 10.0.0's release notes mention neither
  issue, and nothing here was run under Vitest 5, so the question is untouched rather than resolved.
  [Detail](backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it)

- **Whether a declared floor follows the installed version is undecided — one decision for every
  manifest** — left behind by the dependency refresh (#432, 2026-09-19). The answer goes in
  `versioning-strategy` in `.github/dependabot.yml`.
  [Detail](backlog/dependencies.md#whether-a-declared-floor-follows-the-installed-version-is-undecided--one-decision-for-every-manifest)

- **One esbuild copy older than ours stays in the tree: `drizzle-kit`'s own range holds it** at
  0.25.12; since A107 a root `pnpm.overrides` entry moves `@esbuild-kit/core-utils`' copy onto the
  same 0.25.12. An install that re-resolves the lockfile still warns that the `@esbuild-kit`
  packages are deprecated.
  Left behind by the esbuild upgrade (#439, 2026-09-19).

- **`apps/dashboard` type-checks against two `@types/node` majors at once** — left behind by the
  Node types upgrade (#441, 2026-09-19). The fix is a pnpm resolution override, which is a policy
  decision, so it was left for the owner.
  [Detail](backlog/dependencies.md#appsdashboard-type-checks-against-two-typesnode-majors-at-once)

- **The root `package.json` says `"engines": { "node": ">=24" }` while `.nvmrc` says 26.** One line
  either way; it needs an owner call on whether Node 24 is still supported.
  Left behind by the Node types upgrade (#441, 2026-09-19).

- **Only the request side of that adapter was compared between the two versions** — left behind by
  the Hono Node adapter upgrade (#444, 2026-09-19). `apps/server` and `apps/print-agent` moved from
  `@hono/node-server` 1.19.15 to 2.1.1. The suites pass, so nothing is known to be broken.
  Re-running the comparison needs a scratch install of 1.19.15.
  [Detail](backlog/dependencies.md#only-the-request-side-of-that-adapter-was-compared-between-the-two-versions)

- **`apps/server/src/tls.ts`'s type guarantee is still untested.** It derives its options type from
  the installed package (`Parameters<typeof serve>[0]`) so that an incompatible reshape fails
  `tsc`; this upgrade did not exercise that, because the type was otherwise identical across the two
  versions.
  Left behind by the Hono Node adapter upgrade (#444, 2026-09-19).

- **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo** — left
  behind by the vite 8 upgrade (#450, 2026-09-19). What is missing is anywhere that states a browser
  floor, so the next bump moves it again silently.
  [Detail](backlog/dependencies.md#the-default-browser-floor-rose-and-no-browser-floor-is-stated-anywhere-in-the-repo)

- **The browser-mode packages that declare no vite follow the others' by deduplication, not by a
  declaration** — left behind by the vite 8 upgrade (#450, 2026-09-19). If a future change puts a
  second vite in the tree, they could land on a different one silently.
  [Detail](backlog/dependencies.md#the-browser-mode-packages-that-declare-no-vite-follow-the-others-by-deduplication-not-by-a-declaration)

- **A dependency-optimizer receipt taken on vite 6 was not re-measured** — left behind by the vite 8
  upgrade (#450, 2026-09-19). Nobody re-checked that vite 8 still emits that warning, or that the
  `include` lists are still the fix.
  [Detail](backlog/dependencies.md#a-dependency-optimizer-receipt-taken-on-vite-6-was-not-re-measured)

- **The till's QR pin compares the code against itself, not an authority** — left behind by the till
  QR library upgrade (qrcode-generator 1 -> 2, 2026-09-20). Giving the till the same reader needs a
  matrix accessor as well (`qrSvg` returns a string, never the library's `qr` object) and a
  module-boundary decision about where the helper lives.
  [Detail](backlog/dependencies.md#the-tills-qr-pin-compares-the-code-against-itself-not-an-authority)

- **There is no snapshot file anywhere in the repository**, so the till's byte pin is a SHA-256 of
  the output. A file snapshot would fail with a readable diff; whether this repo wants snapshot
  files at all is an owner decision.
  Left behind by the till QR library upgrade (qrcode-generator 1 -> 2, 2026-09-20).

- **`node-forge` has a high-severity security alert with no fixed version** — OPEN (Dependabot alert
  #20, 2026-10-01). Every version up to 1.4.0, the one in the lockfile, accepts some RSA signatures
  it should reject when checking them. It is a direct dependency of `packages/server-kit`,
  `apps/server` and `apps/print-agent`. **Next action:** bump it when a fixed version is published,
  and run the certificate suites in those three packages.
  [Detail](backlog/dependencies.md#node-forge-has-a-high-severity-security-alert-with-no-fixed-version)

- **Whether the vulnerability the upgrade fixes is reachable in this product is open** — left behind
  by the passkey library upgrade (#453, 2026-09-19). `@simplewebauthn/server` and
  `@simplewebauthn/browser` moved to 14. The cheap evidence leans towards reachable rather than
  away.
  [Detail](backlog/dependencies.md#whether-the-vulnerability-the-upgrade-fixes-is-reachable-in-this-product-is-open)

- **The version-14 browser helpers are unused.** Whether `browserSupportsPasskeys()` would improve
  the login screen's `browserSupportsWebAuthnAutofill()` gate has not been assessed.
  Left behind by the passkey library upgrade (#453, 2026-09-19).

### Modules, data and code health

_Formerly B8, parts of B9, and the old Track C's correctness items; part of A9._ Detail: [backlog/architecture.md](backlog/architecture.md).

- **A435 — permanent delete for hardware and venue setup (owner, 2026-10-08; steps 2–6 open).**
  Printers are next. Each point below is a separate remaining step.
  [Spec](superpowers/specs/2026-10-08-delete-and-archive-design.md),
  [product archive plan](superpowers/plans/2026-10-08-a435-1-product-archive.md).
- **A435 step 2 — printers: open, next.** Add permanent Delete beside Disable, the impact read,
  deleted-state uniqueness rules and shared confirmation dialog.
  [Printer delete plan](superpowers/plans/2026-10-09-a435-2-printer-delete.md).
- **A435 step 3 — card readers: open, following printers in the build order.** Add permanent Delete beside Disable.
- **A435 step 4 — devices: open, following printers in the build order.** Add permanent Delete beside Disable.
- **A435 step 5 — courses and kitchen stations: open, following devices in the build order.** Replace Disable with Delete.
- **A435 step 6 — tables, zones and departments: open, following courses and stations in the build order.** Replace
  Disable with Delete. Each remaining step follows the linked spec and preserves recorded history.


- **`modules.json` has no flow-down channel** from a primary to its standby (matters under
  _Afterwards_, designed now that bookings is genuinely toggleable), and a toggleable module that is
  load-bearing (identity, payments) fails boot loudly if disabled until the wiring inversion.

- **Country-pack follow-ons:** the authenticated address relay and its first provider adapter; phone
  normalisation in bookings; a supplier country/identifier scheme before validating purchasing tax
  IDs; the pack's module preset; the refused foral, Canary, Ceuta and Melilla jurisdictions; a
  territory picker in the setup wizard (it offers `ES-common` only).

- **`fiscal-none` left-behinds:** remove the inert `resolveClient`/`skipRetryMs`; regime-agnostic
  provisioning tests.

- **The tax-model system** — the `tax` slot is an inert label today; the intended shape puts the tax
  MODEL in core with the fiscal module supplying rates and labels. A prerequisite for any non-ES
  venue, so parked.

- **Copies of the patterns A105 and C27 replaced — OPEN.** The same two SQL patterns (the
  block-comment one A105 replaced, and `/--.*$/`, the one C27 replaced) are copied in
  `scripts/module-graph-honesty.test.ts`, a guard reading the repository's own SQL. [Detail](backlog/architecture.md#copies-of-the-patterns-a105-and-c27-replaced)

- **The two SQL scanners named `stripSql` blank block comments before `--` comments — OPEN (split
  from A95).** Read, not run; whether any file they scan has a `/*` inside a `--` comment or a string
  is not measured. [Detail](backlog/architecture.md#the-two-sql-scanners-named-stripsql-blank-block-comments-before----comments)

- **What the grants refuse ONE OPERATION AT A TIME is not guarded (2026-09-19).**
  `scripts/write-path-tables.test.ts` (#430) covers the tables request code may read and never write
  and nothing else. **Next action:** decide before the flip between three shapes. [Detail](backlog/architecture.md#what-the-grants-refuse-one-operation-at-a-time-is-not-guarded)

- **Still unprobed: the remaining "not a 500" titles across the `apps/server` route suites**, which
  name no engine. Left open by C127 (#1036, #1042), after which no comment or test title names a
  PostgreSQL SQLSTATE as today's behaviour.

- **Small renames and dead exports the sweep found and could not make — OPEN (T2, 2026-09-23;
  narrowed by A92 and #1039).** Still open: `apps/server/src/working-order-reads.sqlite.test.ts` keeps
  its `.sqlite.` infix because the approved slice 3d plan ran it by that name. The
  `provisioning.invalid_identifier` error registry entry remains. [Detail](backlog/architecture.md#small-renames-and-dead-exports-the-sweep-found-and-could-not-make)

- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  Not reached by any package's pull request: `bench/` (about 2,300 comment lines) and the root
  `vitest.config.ts` and `eslint.config.js`; in `scripts/`, the `.sh` files and
  `write-path-tables.json` are outside the checker and were left. What each pruning pull request
  found and could not fix is listed under its own area, as "found by #NNN while pruning comments".
  [Detail](backlog/architecture.md#prune-the-comments-one-package-per-pull-request)

- **`apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same
  condition by construction"** — found by the retroactive Codex reviews of #621–#626 and #629
  (C3.18.12r) while pruning comments. `apps/server/src/rebuild-first-start.ts` (near line 121, lane
  A's file) says "The log carries the error's code only", the overclaim #637 corrected in
  `health.ts` (`codeOf` logs `unknown` for a plain error carrying `code: "EIO"`).
  [Detail](backlog/architecture.md#appsserverreadmemd-near-line-496-still-says-an-error-line-and-a-503-are-the-same-condition-by-construction)

- **`working-order.ts` (near `requireLiveCourse`) says the fire verbs use the same live-course
  definition; `fireCourse` calls `requireCourse`** — found by #622 while pruning comments. The
  lock-ordering and deadlock cases for transfers, merges and split bills went with PostgreSQL and
  nothing replaced them (one write transaction per venue file is what serialises those writers now).
  [Detail](backlog/architecture.md#working-orderts-near-requirelivecourse-says-the-fire-verbs-use-the-same-live-course-definition-firecourse-calls-requirecourse)

- **`apps/server` test titles still say an unscreened malformed id becomes an opaque 500, although
  ids are text columns now** — found by #600 while pruning comments. Nothing the review could find
  copies `node_membership` from the primary to a standby, so a promoting standby may take
  `nextStandings`' fallback that appends it with an empty `contactUrl` (`packages/membership`),
  which `routableServers` then drops.
  [Detail](backlog/architecture.md#appsserver-test-titles-still-say-an-unscreened-malformed-id-becomes-an-opaque-500-although-ids-are-text-columns-now)

- **Pointers outside `docs/` that #597 made stale** — found by #597 while pruning comments. The fake
  SumUp client leaves its one-shot switches for a lookup or a refund armed when a checkout before
  them is refused; no test combines the two.
  [Detail](backlog/architecture.md#pointers-outside-docs-that-597-made-stale)

- **"Nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`)" … is too
  wide** — found by #567 while pruning comments. The same claim stands in
  `packages/fiscal-verifactu/src/venue-fields.ts`.
  [Detail](backlog/architecture.md#nothing-under-apps-may-import-a-regime-package-scriptsmodule-seamstestts--is-too-wide)

- **`isLocked` in `venue-lock.ts` reads `.errcode` without a null check**, so a thrown `null` would
  raise a `TypeError` (the driver throws real errors). `packages/store`, found by #568 and not
  changed.

- **Nothing now checks at run time that a read returns something other than a Node `Buffer`** —
  found by #577 while pruning comments (`packages/credentials`). Nothing checks that a caller other
  than the application cannot read or list the vault; only the encryption protects it.
  [Detail](backlog/architecture.md#nothing-now-checks-at-run-time-that-a-read-returns-something-other-than-a-node-buffer)

- **The nested `tx.transaction(...)` in `enqueueSuccessor` wraps one insert** — found by #581 while
  pruning comments (`packages/scheduler`). Whether to remove these two nested calls, or say why they
  stay, is open (a code change, not made).
  [Detail](backlog/architecture.md#the-nested-txtransaction-in-enqueuesuccessor-wraps-one-insert)

- **`decimalToCents` refuses an amount over the bound (#583), but `centsToDecimal` itself has no
  digit bound** — found by #579 while pruning comments (`packages/shared`).
  `docs/developers/conventions-data.md` (the "no column width left to measure" paragraph) has only
  the PostgreSQL raw-read table, not the SQLite one #579's commit message now carries.
  [Detail](backlog/architecture.md#decimaltocents-refuses-an-amount-over-the-bound-583-but-centstodecimal-itself-has-no-digit-bound)

- **`product.not_found` has no dashboard wording, so the recipe screen shows the generic message for
  it** — left open by A394-2 (#1444); still so after A394-3 (#1447).

- **`GET …/locations/:locationId/catalogues` and the member `DELETE` answer as before for an unknown
  location** — left open by A394-3 (#1447).

- **A malformed menu or location path id still answers 400 `shared.invalid_id` until A394-22, while
  the course route answers 404** — left open by A394-3 (#1447).

- **The two location routes' body menu id keeps 404 until A394-11** — left open by A394-3 (#1447).

- **Workforce refuses an unknown BODY location as `management.request_invalid` while catalogue's
  PATH location answers `location.not_found`** — left open by A394-3 (#1447). If workforce moves to
  the new code, declare it in `packages/db/src/errors.ts`.

- **A394-5, A394-6, A394-8 to A394-17 and A394-20 to A394-22 — refusal statuses by one rule** — OPEN, low priority, not queued — owner
  2026-10-08: take them from here when a lane has room. (A394-1 to A394-4 landed as #1441, #1444,
  #1447 and #1455.) Read, not run: of 49 boundaries, 96 status rows break the rule
  (`docs/developers/conventions-data.md`); 17 defects answer 500 or success for a missing id (A394-1
  to -6 first); 16 owner questions; A394-8 settles A374's. The follow-ups and the rows:
  `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.

- **Purchase invoice create/edit refusal tests do not pin the original failure** — OPEN, carried
  from A394-4. In `packages/purchasing/src/operations.test.ts`, the “other refusal passes through” cases
  assert `isAppError(error)` is false. Next: assert the original refusal's identity
  or cause so a different non-domain error cannot satisfy them.

- **Comments and test titles still cite sections of specs that were deleted** — OPEN (2026-09-26). A
  pointer that names only a SECTION ("spec §3.2", "design §3", "(till-reroute §3.6)") was fixed only
  for the last 28 documents. **Next action:** fold into the comment-pruning sweeps: re-point each to
  the pull request that built the work, or drop the tag.
  [Detail](backlog/architecture.md#comments-and-test-titles-still-cite-sections-of-specs-that-were-deleted)

- **Three shapes the read connection does not cover** — OPEN (stated 2026-09-23, task N3, PR #493).
  A transaction opened by RUNNING `begin` as an ordinary statement is not one the store is told
  about — Drizzle's own migrator opens one that way — so a read concurrent with it still lands on
  the writer. **Next action:** none needed while that holds; a temporary table, an attachment or a
  connection pragma issued from OUTSIDE a running body has to be put on the writer deliberately, and
  a guard for that does not exist.
  [Detail](backlog/architecture.md#three-shapes-the-read-connection-does-not-cover)

- **Every read route now takes the venue's exclusive write lock and issues a DELETE** — OPEN (found
  2026-09-23, task F1's review wave). `withTransaction` (`packages/db/src/tenancy.ts`) runs its body
  inside `withWriteLock` and then drains `change_log` unconditionally, which is a `delete … returning`.
  **Next action:** decide whether a read-only body should take the lock at all.
  [Detail](backlog/architecture.md#every-read-route-now-takes-the-venues-exclusive-write-lock-and-issues-a-delete)

- **Three copies of one SQL identifier validator and two cause-chain walkers** — OPEN (found
  2026-09-23, task F1's review wave). The identifier validator is in
  `packages/db/src/testing/identifiers.ts`, `packages/db/src/change-feed.ts` and
  `packages/store/src/append-only.ts` — the first two are in the SAME package. **Next action:**
  export one validator from `@waitron/shared`; `packages/store` depends on nothing today, and
  `@waitron/shared` depends on nothing either, so that edge closes no loop.
  [Detail](backlog/architecture.md#three-copies-of-one-sql-identifier-validator-and-two-cause-chain-walkers)

- **`resolveEnvironment` and `deploymentEnvironment` are two hand-maintained copies of one
  four-branch table** — OPEN (found 2026-09-23, task F1's review wave).
  `packages/provisioning/src/environment.ts` and `apps/server/src/config.ts`. This decides whether a
  box files against the real AEAT or the test one (`CLAUDE.md` §5), so two copies held together by
  hand is the wrong shape for it.
  [Detail](backlog/architecture.md#resolveenvironment-and-deploymentenvironment-are-two-hand-maintained-copies-of-one-four-branch-table)

- **Raw engine imports in `apps/server/src/recovery-lock.ts` and
  `apps/server/scripts/cloud-backup-fixture.ts`** — left open by W45 (#1155), which closed
  "`packages/migrations` opened its own raw `node:sqlite` connection": a 2026-10-03 search of
  non-test files under `apps/` and `packages/` also found raw engine imports in
  `apps/server/src/recovery-lock.ts` and `apps/server/scripts/cloud-backup-fixture.ts`. **Next
  action:** review each remaining raw connection separately before deciding whether a shared store
  API fits.

- **Files that still spell the store's file names themselves** — left by #757, which exported them
  from `@waitron/store`. #757's checks do not cover `migrations.lock`, Litestream's
  `.venue.db-litestream/` folder, or the restore's `venue.db.incoming` file and
  `.venue.db-replaced-*` folder.
  [Detail](backlog/architecture.md#files-that-still-spell-the-stores-file-names-themselves)

- **Two leftovers of the restrict/trigger refusal split (#731).** `isRefusal` with
  `RESTRICT_VIOLATION` or `TRIGGER_ABORT` still reads the number alone and both stay exported (the
  `CLAUDE.md` §3 rule, unguarded, is what stands against a new caller); and the four near-identical
  word-matching checks in `packages/db/src/constraint-target.ts` could share one private helper.

- **An append-only trigger can be dropped, or quietly replaced, from the application's own database
  handle** — OPEN (found 2026-09-22, task F1). Data mutations are still refused while the triggers
  are in place, so this is defence in depth rather than a live hole. **The defence to build:** at
  boot, and then on a repeating check while the box runs, read `sqlite_master` and refuse to trade
  if any append-only trigger that should be there is missing, or its stored text is not the text
  `installAppendOnlyTriggers` writes (`packages/store/src/append-only.ts`).
  [Detail](backlog/architecture.md#an-append-only-trigger-can-be-dropped-or-quietly-replaced-from-the-applications-own-database-handle)

- **`apps/server` → `apps/print-agent` is the first app-to-app workspace edge in the tree** — left
  behind by the TypeScript 7 upgrade (#460, 2026-09-20). Moving the WHOLE cohort would settle it,
  and that is a print agent layering decision.
  [Detail](backlog/architecture.md#appsserver--appsprint-agent-is-the-first-app-to-app-workspace-edge-in-the-tree)

- **Four order paths read `working_orders` by id alone, with nothing narrowing them to the caller's
  location.** The TENANT half is retired — there is no tenant column (`CLAUDE.md` §3) — but the
  location half is open and is NOT covered by item 2, which names a different set of verbs.
  [Detail](backlog/architecture.md#four-order-paths-read-working_orders-by-id-alone-with-nothing-narrowing-them-to-the-callers-location)

- **Location-scope the by-id verb family together** (`getHeldOrder`/`getPlacedCounterOrder`/
  `updateHeldOrder`/`abandonHeldOrder`, `updateTable`/`deactivateTable`/`openTab`) when multi-location lands —
  together with the four paths in item 1, which are the same problem in the same file.

- **Nothing stops two queries being started at once on one transaction.** The rule and its receipt
  are in `docs/developers/conventions-data.md` under "Multi-table writes share ONE transaction"; no
  test or lint rule enforces it. A guard could fail a test whenever a query is issued on a
  transaction while another is still running.

- **These index and key names still read `tenant`, and the columns they name are gone** — left
  behind by the tenant-column removal (#378, 2026-09-16). This is its own slice, not a tidy-up:
  THREE of the four `persons_*` names are matched BY NAME in production error translation —
  `persons_tenant_email_uq` (`packages/identity/src/staff.ts` and `account-action.ts`),
  `persons_tenant_live_display_name_uq` and `persons_tenant_pending_email_uq` (`staff.ts`) — so
  renaming them changes behaviour and wants its own failing tests first.
  [Detail](backlog/architecture.md#these-index-and-key-names-still-read-tenant-and-the-columns-they-name-are-gone)

- **Decide whether to implement `sale.number_reused`.** It was added in `10b16fd57` for a
  translation of the invoice-number unique-index violation that was never written. Decide whether
  that translation is still wanted before deleting the code (A77 kept it pending this).
  Listed with the names left behind by the tenant-column removal (#378, 2026-09-16).

- **`server.credential_unusable` names an unusable credential, although `server.*` is reserved for
  facts about the process itself** — left behind by the tenant-column removal (#378, 2026-09-16).
  **Next action:** choose a prefix (`credentials.missing` is the nearest sibling) and rename it in
  one change, checking the prefix matchers `docs/developers/conventions-data.md` lists.
  [Detail](backlog/architecture.md#servercredential_unusable-names-an-unusable-credential-although-server-is-reserved-for-facts-about-the-process-itself)

- **`DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1** — left behind
  by the tenant-column removal (#378, 2026-09-16). A rename would want to keep that "did this pass
  attempt work?" meaning rather than flatten it to a boolean, since the flag deliberately
  distinguishes a no-work pass from a pass that exercised the certificate and skipped.
  [Detail](backlog/architecture.md#drainresulttenantswithwork-is-named-for-a-count-that-can-now-only-be-0-or-1)

- An `int4InRange` helper collapsing four int4-bounds parsers; an options object for the positional
  `create/updateDeviceProfile` verbs; a shared `SeedDeviceProfileInput`; a `BRAND_PRIMARY_HEX`
  constant (the theme colour is literal in three places).

- **Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce.** Each
  site needs checking against the path it actually takes, then rewording. Left open by SQLite slice
  1 (#490 and the preparation tasks).
  [Detail](backlog/architecture.md#comments-still-describe-a-drizzlequeryerror-wrapper-that-this-engine-does-not-produce)

- **`void cfg` lines remain in `apps/server/src`** (`git grep -n 'void cfg;' apps/server/src`): test
  helpers, and production functions (`apps/server/src/working-order.ts` holds several) that take
  `cfg` and discard it. Left open by SQLite slice 1 (#490 and the preparation tasks).

- **A1c. Dead pointers to deleted test suites** — Comments across many packages still cite deleted
  guard suites, from two deletions. Fix whenever a file is open anyway; the comment-pruning sweep
  (B9 → _Prune the comments_) reaches every package and takes these as it goes.
  [Detail](backlog/architecture.md#a1c-dead-pointers-to-deleted-test-suites)

- `resolveInstalledDefaultContentLanguage` (`packages/country-packs/src/registry.ts`) **is now
  called only by its own tests; delete it with its cases**: nothing else calls it, because the built
  Task 6 works out the default itself, and only the demo-data plan's Task 6 sketch still names it.
  Left by #1320 (W109-6, content languages per region), OPEN, unqueued.

- `partyFamilies`, the reverse lookup of `partySurvivors`, stayed in `apps/server/src/parties.ts`,
  while `partySurvivors` is in `packages/db/src/party-table-labels.ts`. Left open by the table
  actions plan's Task 8 (#869, move guests, join and split tables) and C77/C86.

- The device-management routes build their `devices ⨝ device_profiles` read inline
  (`apps/server/src/device-api.ts`) where a `listDevices` store verb belongs.

- **`declarations` in `apps/server/src/configuration-transfer.ts` uses `module:<name>` when a local
  module lacks its transfer declaration** — left open by A261-2e's review (#1277). Reachability with
  the installed module list is unverified; distinguish that local build defect from an incompatible
  artifact if it can reach setup.

- **The configuration import answers a routing cell's `service_zone.not_found` 400, while the grid's
  save answers the same code 404** — left open by A374 (#1403). The owner answered on 2026-10-08
  that every API answers a refusal by one rule based on what it means; A394-8 settles it (above).
  [Detail](backlog/architecture.md#the-configuration-import-answers-a-routing-cells-service_zonenot_found-400-while-the-grids-save-answers-the-same-code-404)

- **The configuration import answers `zone.department_inactive` 400, while the dashboard's saves
  answer the same code 409** — left open by A393 (#1425) (`packages/venue-service/src/routes.ts`,
  `apps/server/src/management-api.ts`), which A394's audit covers too.
  [Detail](backlog/architecture.md#the-configuration-import-answers-zonedepartment_inactive-400-while-the-dashboards-saves-answer-the-same-code-409)

- **`listOrders`'s `orderIn` filter (`apps/server/src/orders-list.ts`) is applied to `r.id`**,
  which for a sale row of the union is the sale's id, not its order's: today's only caller
  asks for collectable rows, so nothing reaches it, but a caller without `collectable: true`
  would get every sale row unfiltered. Left open by W97 (#1311).

- **SP-4 — the module UI surface on the TILL** (card-registry inversion, self-sourcing cards); the
  dashboard half is done. Migrate the remaining core dashboard screens onto the module UI seat and off
  the coarse `requiresManager` gate. A core nav item can now also name a `requiresPermission`
  (`apps/dashboard/src/dashboard-app.ts`); Servers (`mirror.create`) is the first to use it.

- **No route raises `menu_item.variant_not_allowed`**: `addProductToMenu` is its only thrower and
  the demo seed its only caller outside tests. The code and its 400 in
  `apps/server/src/catalogue-api.ts` are left for whoever next prunes unraised codes.

### Data protection and legal compliance

_Formerly entries spread across the old sections._

- **libvips is LGPL-3.0-or-later** and ships in the box image with its notices and a written
  source offer in `/app/third-party/` (`deploy/third-party/`). The legal advisor is asked to
  confirm it (`docs/compliance/action-plan.md`, 2026-09-23). Left open by photos shrunk
  on upload (#543).

### Later and parked

_Formerly the "Later and parked" paragraph under What's built._

**Later and parked** (no owner decision pending; reopen when work reaches them): Square and
generic CSV menu import · accounting export (SP17) · opening hours and channel sync (SP19) · tip
payroll (SP13) · online ordering (SP15) · per-seat ordering and multiple tabs per table (each reopens a
settled decision — specced with the owner, never landed unattended) · KDS ops polish (routing
read-back and audit view, station kind, definable kitchen statuses) · recipes depth (nested
sub-recipes, plate costing, stock depletion, variants, customer-facing browse) · inventory and
procurement (SP20; the AI forecast waits for the deterministic system) · the expo device kind ·
**Bizum** (research in
[2026-09-18-online-payment-providers-bizum.md](research/2026-09-18-online-payment-providers-bizum.md)).
A Bizum payment costs a FLAT per-payment fee, not a percentage, so a provider that passes the
acquiring cost through and marks it up thinly (Mollie, Sipay) beats one charging a percentage on top
(Stripe at 1,5 % + 0,25 €, MONEI); SumUp offers Bizum on none of its plans. **To close:** a written
quote from Mollie and one from the deli's bank (the pass-through figures that would decide it are
unpublished); and, for in-person Bizum, confirm whether a SumUp or Stripe Tap-to-Pay phone can accept
a Bizum tap before designing any UX.

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
- **Comments are cut on touch, and pruned deliberately one package per pull request** (CLAUDE.md
  §1) — see _Modules, data and code health_ → _Prune the comments_.
- **Update this file as entries finish**, in the same PR (_How to keep this file honest_).

**Run path (local; no hardware, cloud, or AEAT cert):** `wa-wt demo <worktree-name>` → default till
<http://localhost:5190>, dashboard <http://localhost:5191>, setup <http://localhost:5192>, server
:8080. `wa-wt ls` shows the shifted ports if a second stack runs. The till enrols itself on first
load in dev mode. Till PIN **5555**; dashboard **owner@demo.waitron.local / dashPass123**.
`dev:setup` seeds three menus (~44 products with images), a floor plan (5 zones / ~16 tables),
staff on PIN 5555, and ~28 days of back-dated preproduction sales — seeded in English by default,
Spanish via `WAITRON_SEED_LOCALE=es-ES`, except the customer-facing languages, which are the Madrid
venue's: Spanish by default with English beside it. `wa-wt onboarding <worktree-name>` for a fresh
shipping-style wizard; `wa-wt reset demo|onboarding [worktree-name]` wipes and rebuilds.

---

## Standing decisions

From the 2026-09-05 whole-project design review and since. They supersede older spec text where they
conflict.

- **One tenant per database everywhere, the cloud included, and the schema carries no tenant
  column** (2026-09-14; #378). A tenant is one taxpayer (`country` + `tax_id`), held as the single
  row of `tenants` with its `id` pinned to 1, owning all of its locations. Nothing filters a query
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
| 3   | Fiscal layer                 | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`)                                                                                                                                                                                                                                                                                   | F3 asesor/XSD confirmations; AEAT certificate install and renewal after setup; cert distribution to a promoted node; a foreign business customer's identifier type (A1a)      |
| 4   | Payment layer                | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration and adoption (#323, #329)                                                                                                                                                                                                                                                    | webhook `recordSale` hand-off; reconcile remediation UI; the handheld NFC/QR link (_Payments and card readers_)                                                               |
| 5   | Identity                     | persons/sessions, PIN (+ wrong-PIN back-off: per device at sign-in and for override PINs), `authorize()`, roles/permissions, passkeys, email-first dashboard login, emailed invitations and password resets, encrypted TOTP and recovery codes, user admin (#298, #328); a one-time passkey offer on first password sign-in (#347); identity state replicates to a standby                                                        | admin-editable roles; security-change emails; mid-shift-suspension enforce; discount gate; till-refund enforce                                                                |
| 6   | Locations                    | provision-a-sellable-venue (`waitron-provision venue`); departments, zones and menus (#297)                                                                                                                                                                                                                                                                                                                                       | multiple-location creation/editing/deactivation; then location-scope the by-id verb family                                                                                    |
| 7   | Counter POS                  | walk-up cash, park/retrieve, manual + integrated card, prepare & collect, canvas/receipt editors, receipt/drawer printing, cash-drawer authorization — operable end to end                                                                                                                                                                                                                                                        | —                                                                                                                                                                             |
| 8   | Reporting                    | daily close, frozen _cierre Z_, VAT summary, modelo 303 output+input VAT + DR303 file and its download route and its dashboard screen, purchase-invoice UI; dashboard sales screen (with a category sales report, at time of sale or current, printable) + business-overview home                                                                                                                                                 | fiscal filing remainder parked (_Reporting — the fiscal remainder_)                                                                                                           |
| 9   | Deployment                   | the box as two containers with `waitron.sh` install/reset (#285, #314); guided node onboarding (#296); boot diagnosability (#310); CA-trust onboarding + per-OS certificate walkthrough (#330); till reroute S1–S6; promotion endpoint (#272)                                                                                                                                                                                     | USB installer (B3); cloud standby live link + the Waitron Cloud boundary                                                                                                      |
| 10  | Tabs / table service         | TS-1 tables+tabs, TS-2 statuses, TS-3 move/join/merge, TS-4 transfer, till action-flow wiring, TS-5 split-bill (#324)                                                                                                                                                                                                                                                                                                             | core COMPLETE; owner-added extensions parked                                                                                                                                  |
| 11  | Floor plan                   | FP-1 live floor + FP-2 spatial canvas/editor                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                             |
| 12  | KDS / devices                | KDS-1 stations/routing/tickets, KDS-2 courses/fire, KDS-3 expo, KDS-4 kitchen printing, order-timing alerts; device identity + profiles (#199, #231, #269)                                                                                                                                                                                                                                                                        | routing audit view; expo device kind; device-scoped fire/collect routes                                                                                                       |
| 13  | Tips                         | attribution stored (`tenders.tip_amount`) — UI collection ONLY on the integrated-card idle screen                                                                                                                                                                                                                                                                                                                                 | tip-collection UI for cash / manual card / handheld (_Payments and card readers_); payroll export (integrate-not-build)                                                       |
| 14  | Bookings                     | Bookings-1, now the `@waitron/bookings` module (#270, #273)                                                                                                                                                                                                                                                                                                                                                                       | public/online/QR, availability, reminders, CRM, recurring, calendar grid, deposits                                                                                            |
| 15  | Online ordering              | —                                                                                                                                                                                                                                                                                                                                                                                                                                 | not started (later phase)                                                                                                                                                     |
| 16  | Workforce                    | _registro de jornada_ library (chain per node since #268), D2 scheduling, roster authoring + approvals, staff request path + portal                                                                                                                                                                                                                                                                                               | **clocking in and out — no route or screen (A10)**; wage-computation engine (convenio-gated); D3 payroll export (integrate-not-build)                                         |
| 17  | Accounting export            | —                                                                                                                                                                                                                                                                                                                                                                                                                                 | not started (core subset; extends Reporting)                                                                                                                                  |
| 18  | Menu/recipes/allergens       | EU-14 allergens, recipe/BOM allergen inheritance, recipe-authoring UI (**withdrawn from the dashboard by #345**; declarations are now direct on the product), product images, location↔menu membership, extras and options lists end to end (the legacy option groups are gone — Task 13 dropped their tables), per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297) | counter/walk-up kitchen fire; menu schedule (publishing landed, #677); customer-facing menu surface parked; nested sub-recipes / plate costing / stock depletion parked       |
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

**No fiscal advisor is engaged**, and [compliance/who-to-ask.md](compliance/who-to-ask.md) says every
candidate turned out to be a marketing page — so engaging is itself a task with a lead time, in
parallel, blocking nothing. Before paying for answers, re-read every question in
[asesor-questions.md](compliance/asesor-questions.md) against the current Waitron architecture.
Cloud archive and hosting questions, including the historical cloud-storage document's §8a,
are now tracked in the [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md).
Keep core fiscal questions here and coordinate shared assumptions with that review.
Q16 (operating from abroad) remains outside the Spanish rollout's question set under its
Spain-hosting assumption; wider country policy belongs to Cloud.

| Q                                                                                                     | Assumption in the tree                                                                                                                                                                                     | Status                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Q13 (tips outside VAT base)                                                                           | tip lives on `tenders.tip_amount`, never handed to the fiscal backend                                                                                                                                      | **Closed** on primary source                                                                                               |
| Q15 (short payment = descuento)                                                                       | a _descuento_ agreed at/before issuance is outside the base (LIVA 78.Tres.2º)                                                                                                                              | **Closed** on primary source                                                                                               |
| Q5(a) (one series per till)                                                                           | a series belongs to the server-SIF; two concurrent SIFs need **disjoint** series                                                                                                                           | needs advisor                                                                                                              |
| Q5(c)/(d) (tickets and full invoices in one series)                                                   | A231's branch requires `full` for F1 and F3                                                                                                                                                                | (c) **answered** on primary source (art. 7.1.a): separate series; (d) confirms where F3 and R5 go; finish A1e through A231 |
| **Q14 (precuenta → amendment log)**                                                                   | a printed pre-bill may oblige an amendment log                                                                                                                                                             | **Open** — the interpretive hinge                                                                                          |
| Q21 (pre-bill, or the invoice when a table asks for the bill)                                         | the table screen prints no pre-bill; when one is built, printing it never fires held food and never marks a line sent (menus plan D10)                                                                     | needs advisor                                                                                                              |
| F3 canje (`IDOtro`, a separate F3 series, `Destinatarios` XSD)                                        | foreign recipient refused; A231's branch requires `full`                                                                                                                                                   | needs advisor / XSD before the first real filing                                                                           |
| Q27–Q29 (paying a bill in parts, a table that leaves without paying, how a comp or discount shows)    | parts: server built (#721), the till does not use it yet; comps and discounts built (#916); leaving without paying built on the owner's decision (B17)                                                     | **send now** — Q28 to confirm the owner's 2026-10-01 decision                                                              |
| Q31 (correct an issued ticket by differences or by substitution)                                      | `recordCorrection` files by differences (`"I"`); no route calls it _(2026-10-02, C126: the whole-order cancel route now calls it for a whole-invoice credit)_                                              | needs advisor before the correction screen is designed                                                                     |
| Q32 (how a cancelled order's already-issued simplified invoice is undone)                             | the whole-order cancel credits the invoice in full with an R5 corrective invoice, not an annulment (C126)                                                                                                  | built on the owner's 2026-10-02 decision; needs advisor to confirm                                                         |
| Q42 (a bill paid later by transfer: invoice now, or a proforma and the invoice on payment; F1 and F2) | no till action issues an invoice for the customer to pay later (only invoice-first placing and an unpaid departure issue one before payment); a payment by transfer is refused (`sale.unsupported_tender`) | needs advisor before A275 is designed                                                                                      |

**The laboral advisor** (a _graduado social / gestoría_) has its own list in
[asesor-laboral-questions.md](compliance/asesor-laboral-questions.md). Nothing there blocks the build;
two items want confirming before go-live (the digital-registro RD's status; the provincial convenio
and figures), plus whether a location's exported working-time record may show per-node chains. The
gestoría's payroll import layout is the one build dependency (it fixes the D3 export format). A tip
collected through the card terminal is business income — an accounting/payroll matter, not the
factura.

**Data protection (RGPD) is a third track, never scoped end-to-end.** Scope it before engaging a
DPO: a data map (what personal data, where, how long); the controller-versus-processor split and
whether a DPA is needed; the venue-facing duties (privacy notice, lawful basis, access/erasure/
portability, breach notification, retention) and which Waitron must _build_ versus the venue must
_operate_. Blocks nothing today; the retention/erasure/export mechanics become build work once
scoped.

---

## Reference

**Adding a database test to a new package.** Give the suite `useVenueDb` and the migration sets it
needs; it makes its own temporary venue directory. A worker limit is still a per-package call, and
the reason that is left is the `@vitest/coverage-v8` cross-fork branch-merge artifact, which needs
`maxWorkers: 1` where a small package runs under `pnpm -r` oversubscription — the worked reasoning
is in #558's first commit message (2026-09-24). `packages/db` keeps `maxWorkers: 4`, which CI's
`test-heavy` shards inherit because they pass no worker count of their own. Either way a new package
that copies one of those configs must hold `98/98/98/95` (CLAUDE.md §2) — anything else and
`scripts/coverage-thresholds.test.ts` fails it in the ungated `lint` job.

**Specs still in the tree** (checked against the code 2026-09-27). A spec whose work is built is
deleted once nothing points at it; one stays while a developer doc or code comment points at it, or
while it holds decisions still open.

| Spec                                                                                                                                                                                              | State                                                                                                                                                                      | Open work lives in                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [POS architecture](superpowers/specs/2026-07-18-pos-architecture-design.md)                                                                                                                       | the strategy; §2's sub-projects                                                                                                                                            | _What's built_                                                            |
| [Workforce and time record](superpowers/specs/2026-07-22-workforce-and-time-record-design.md)                                                                                                     | partly built; no clocking in                                                                                                                                               | A10 and _Wages / labour cost (SP16)_ (_Working time and staff_)                 |
| [Deli hardware](superpowers/specs/2026-07-30-deli-hardware-design.md)                                                                                                                             | partly built; the outage path changed 2026-09-11                                                                                                                           | _Payments and card readers_                                               |
| [Nested sub-recipes](superpowers/specs/2026-08-16-nested-sub-recipes-design.md) and its plan                                                                                                      | not started; parked; the plan predates SQLite and Vitest 4                                                                                                                 | _Later and parked_ (recipes depth)                                        |
| [Expo device kind](superpowers/specs/2026-08-17-expo-device-kind-design.md)                                                                                                                       | not started; parked; written before device profiles                                                                                                                        | _Later and parked_                                                        |
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

**Dev stack from a worktree.** `wa-wt demo|onboarding <worktree-name>` starts up to two isolated
stacks. `wa-wt ls` shows their ports; `wa-wt reset demo|onboarding <worktree-name>` rebuilds only
the named venue. The rule is in CLAUDE.md §6; detail in
[ui-review.md](ui-review.md) → _Running the stack from a worktree_.

## How to keep this file honest

Update it in the change that makes it stale (CLAUDE.md §6, _Docs_). In particular:

- **A change that finishes an entry deletes it** — never mark it landed, done, built or merged.
  Each point it leaves open becomes its own short entry in the same area, titled from the point's
  own words and naming the finished entry's id and PR once ("left open by A231d part 1, #1399").
  Take the finished piece out of _What to work on next_ and the _What's built_ "Remaining" column
  too, and do not add a receipt paragraph. **This is state, not history; the git log is the
  history.**
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
