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

Ranked by the owner on 2026-10-16, for the time they are away (17 October to 2 November). Each item
is its own brainstorm → spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.
Everything not listed here needs more spec work first.

1. **A773 — courses, groups and the pass** (_The till, devices and table service_). A773-1, the
   table screen's unsent list, has a plan; A773-2, firing and the pass, is planned once A773-1
   lands.
   **A803 — bills and tables** follows A773-1 (owner, 2026-10-18); its pass and station-setting
   slices wait for A773-2.
2. **A682 — translations: nothing required, every missing name reported, all languages side by
   side, with automatic translation** (_Menus and the catalogue_).
3. **A646 — a Modules page where the administrator switches optional modules on and sets them up**
   (_Modules, data and code health_). Its revised design awaits agreement.
4. **A664 — archive or delete a venue's old data once it no longer has to be kept** (_Data
   protection and legal compliance_). Adviser agreement, build and verification remain open.
5. **A582 — help mode: a "?" in the top bar marks everything that has help** (_Users, sign-in and
   the dashboard shell_).

**Ready to queue when a lane is free (owner, 2026-10-18), not ranked against the list above:**
**A802 — correct part of a paid invoice** (_Fiscal records, invoices and the asesor_).

**Lower priority (owner, 2026-10-16).** These were the top of the list ranked 2026-09-27; they now
come after the list above:

- **Finish table service and paying a bill in parts** (_The till, devices and table service_).
  What Task 16 (counter handover, #981) and Task 17 (#991) left open is in their entries under that
  area. **Send the asesor's [shortened list](compliance/asesor-questions.md#the-shortened-list-2026-10-09)
  (S3, S6, S10 cover Q27–Q29).**
- **Design the fixed screens for each kind of device** (A182 part 1, under _The till, devices and
  table service_). The remaining counter redesign is A738–A739. The handheld, kitchen screen and pass
  were designed on 2026-10-18 as **A797**, waiting for the owner's answer to Q42 (lane C's questions
  file): [design](superpowers/specs/2026-10-18-a797-device-screens-design.md),
  [mockups](backlog/mockups/a797-device-screens/).
- **What a standalone box still lacks before a real venue runs it** (under _The box: backups,
  upgrades and recovery_, except the certificate, under _Fiscal records, invoices and the asesor_):
  installing or renewing the AEAT certificate after setup (A795: designed, three owner questions
  open); upgrade testing with rows the product
  itself writes and a real older database (owner-marked blocking before go-live); the bootable USB
  installer (B3); the degraded-but-trading recovery spec.
- **The displays and the printers walked at the real box** (_The till, devices and table service_;
  _Printers, the print agent and receipts_) — till, handheld and KDS through
  [ui-review.md](ui-review.md), and the first physical print since #327.
- **Smaller, independent pieces**, in no fixed order: refusing requests from a device that is not
  enrolled; Logging Slice 2, the one-touch bug report; the first real Bluetooth pairing at the box
  through the dashboard; paying at the table from a handheld (Slice 2, designed as A796, waiting
  for the owner's answer).
- Then the on-prem mirror and failover — slices 3 to 5 of the storage design — then the cloud
  primary, under _Replication, failover and the cloud_.

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

- **A696. Invoice issue dates and record offsets follow the process zone.**
  [Owner decision, 2026-10-15](superpowers/specs/2026-10-15-a696-invoice-time-zone-design.md#owner-decision-recorded-2026-10-15-the-venues-saved-time-zone):
  every new invoice date and record offset, ordinary receipt and till use the saved venue zone,
  DST included, independently of the process zone; old records stay unchanged. The owner also
  chose restricted guided repair for an invalid or missing zone (17:20). The
  [exact repair design](superpowers/specs/2026-10-15-a696-guided-zone-repair-design.md) awaits approval.
  Next: owner review, then the implementation plan and separate FULL fiscal build. No build
  approval yet; keep A444 separate.
  [Detail](backlog/fiscal.md#walk-up-invoice-dates-follow-the-server-process-time-zone).

- **A444. A full invoice for a meal past midnight should carry the day the meal ends**, not the day
  the bill was opened (A231's provisional rule). The 2026-10-09 research found a binding ruling dating
  a service at its end (V1476-13, by analogy); asked as [S4](compliance/asesor-questions.md#the-shortened-list-2026-10-09). Change before F1 is switched on.
  Fiscal: the owner lands it.

- **Can a simplified invoice carry an operation date different from its issue date?** — left open by A663 Part 2. If it can,
  art. 7.1.c requires that date on the receipt, and the document builder prints one only on a full
  invoice (`apps/server/src/receipt-document.ts`). Check, then print it there too if needed.

- **A445. A free item on a bill with mixed VAT rates should take a share of the price paid**, by
  value, instead of being set to €0 (V0555-17, binding). Only bills mixing rates are affected (the
  deli's 4%, 10% and 21%). A table given everything free may be self-supply taxed at cost
  (V2347-24). Asked as [S10](compliance/asesor-questions.md#the-shortened-list-2026-10-09); decide before going live. Fiscal: the owner lands it.

- **A446. When the pre-bill is built, each printed pre-bill is stored as printed and linked to the
  invoice that follows.** AEAT's FAQ calls a system without that link «susceptible de sanción»,
  and the pre-bill carries no tax QR code. Whether a precuenta counts is asked as [S2](compliance/asesor-questions.md#the-shortened-list-2026-10-09).

- **A447. A guest's part-payment taken before the table is fully served may need its own
  advance-payment invoice** (LIVA 75.Dos, RD 1619/2012 art. 2.1). The server (#721) holds such money
  with no invoice until the bill is paid. Asked as [S3](compliance/asesor-questions.md#the-shortened-list-2026-10-09); no change until answered.

- **A448. Whether a customer's email address alone satisfies TRLGDCU art. 63.3 for an emailed full
  invoice.** [Detail](backlog/fiscal.md#decisions-and-deliberate-limits)
  _2026-10-12: the product no longer asks for consent at all — A231q's tasks C1a and C1b removed it
  ([plan](superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md)) on the owner's 2026-10-09
  answer. Until 2026-10-12 this entry asked that the consent request say how the invoice will arrive
  and how consent is withdrawn._

- **Loose ends left by A230 (`@waitron/verifactu` 0.2.1, #1099).**
  - A resent cancellation AEAT already holds now counts as accepted when AEAT's stored fingerprint
    matches the cancellation's (`drain.ts`'s `handleDuplicate`; a mismatch is refused with
    `fiscal.duplicado_anulado`). Shown against the library's fake only; what real AEAT answers to a
    resent cancellation is not established. The owner may want to confirm this choice.
  - `HUELLA_MISMATCH` is filed and flagged, not refused. It is not expected to occur, since
    Waitron's own builder computes the fingerprint; nothing tests that it cannot. Refusing it may
    be preferred since a wrong fingerprint is permanent.
  - A voided sale whose lookup AEAT answers under the sale's own reference is not handled; not
    shown to happen either way.
  - An unusable `TiempoEsperaEnvio` is not recorded anywhere (the raw value is dropped).

- **No sale over €3,000 can be made at all** — left open by A230 (`@waitron/verifactu` 0.2.1, #1099). Waitron issues only simplified invoices and no screen accepts a customer's tax ID, so a full invoice is not offered. [Detail](backlog/fiscal.md#no-sale-over-3000-can-be-made-at-all)

- **The till offers no way back to a simplified invoice for a bill already saved as a full one** —
  left open by A741 (#1774). The bill still shows its Full invoice line and payment refuses it; the server
  accepts a change back (`setOrderInvoiceChoice`), but nothing on the till sends one.

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

- **`packages/fiscal-verifactu` code** — found by #562 while pruning comments. **Open:** the inner
  try/catch around the log call in `aeat-transport.ts`'s `closeAll` is dead; removing
  `appendToChain`'s nested `tx.transaction` makes no test fail; and `write-path.e2e.test.ts` points
  at fixture lines that have moved. [Detail](backlog/fiscal.md#packagesfiscal-verifactu-code)

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
  (`fiscal.foreign_recipient_unsupported`), deliberately. Whoever wires up business-customer sales
  makes that call. [Detail](backlog/fiscal.md#a1a-a-foreign-business-customer-needs-an-identifier-type-decision)

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
  Public F1 issuance remains disabled; no route calls `recordSubstitution`. **Next action:** verify
  physical 58/80 mm paper and QR output, settle what paying at the counter does with an email or A4
  choice (A555), obtain the asesor's manual-remedy approval and settle applicable B2B delivery
  before enabling public F1.
  [A1e detail](backlog/fiscal.md#a1e-simplified-and-full-invoices-use-separate-series--built-public-f1-disabled-2026-10-06), [A231 detail](backlog/fiscal.md#a231-full-invoices-at-the-till--gated-implementation-landed-2026-10-06)

- **A554. Should any screen show the address an invoice email went to?** An owner question, open
  point 1 of the [A231q plan](superpowers/plans/2026-10-12-a231q-invoice-delivery-part-2.md). Until
  it is answered none does: the delivery status the till and the dashboard read carries no address,
  and both email forms open empty. Left open by A231q.

- **A555. Paying at the counter drops a full invoice's email or A4 choice.** The till sends the
  invoice choice with `POST /api/sales` and `/api/pay`, which read no delivery choice and today
  refuse a full invoice (`sale.full_invoice_unavailable`); a counter choice is staged only when the
  order is placed. Decide what paying does with the choice before public full invoices are switched
  on. Left open by A231q.

- **A556. A full invoice that later replaces a bill's simplified one would not be delivered through
  the bill.** The dashboard's order detail reaches a bill's invoice as the sale carrying that bill's
  id; a replacing full invoice (an F3) is a separate sale, and whether it would carry the bill's id
  was not checked (A231q's review, read, not run). Nothing issues an F3 today: no route calls
  `recordSubstitution`.

- **A557. A success reported after an attempt had ended is not shown.** The delivery status marks
  such an attempt `lateSuccess` (`apps/server/src/invoice-delivery-status.ts`), but neither the till
  nor the dashboard shows it, so staff see only the attempt's earlier outcome. Left open by A231q.

- **A558. The `invoice_delivery.*` refusals other than `.active` end without a full stop**, in the
  till and the dashboard, in English and Spanish (`apps/till/src/i18n/codes.ts`,
  `apps/dashboard/src/i18n/codes.ts`). A wording decision left open by A231q.

- **When the business e-invoicing regime starts** — found by A231d's research. So from about
  October 2027, or October 2028 for smaller businesses, an invoice to a Spanish business must be a
  structured message, and a PDF alone is not enough (the design's register, RD 238/2026 art. 7.1).
  [Detail](backlog/fiscal.md#when-the-business-e-invoicing-regime-starts)

- **A275. Invoice a bill paid later by transfer (full or simplified invoice)** — DESIGN NOW (owner,
  2026-10-17). Design from the research's answer to Q42: the invoice is issued at the meal, and the
  bill stays open as "awaiting transfer" until someone marks it paid; no proforma first for a
  consumer. The design goes back to the owner with one short confirmation question for the asesor
  attached, before any build.
  [Detail](backlog/fiscal.md#a275-invoice-a-bill-paid-later-by-transfer-full-or-simplified-invoice--design-now-2026-10-17)

- **A679. First Live setup: one page and one recovery PDF.** Complete the existing First Live setup
  branch through the [hour-code implementation plan](superpowers/plans/2026-10-16-a679-hour-code-implementation.md).
  The owner approved the [design](superpowers/specs/2026-10-16-a679-hour-coded-series-design.md)
  on 2026-10-16 at 14:50: four UTC-hour characters replace paper/Cloud name allocation;
  the PDF keeps only the recovery key. Protected-code and fiscal-assertion restrictions remain.
  Owner acceptance is viewing real generated EN/ES PDFs through Drive; automated
  recovery-field entry checks remain the driver’s work. Preserve existing branch work.
  [Detail](backlog/fiscal.md#a-venue-without-cloud-needs-a-usable-paper-custodian-route).

- **W41s. Fiscal prevention and offline recovery** — conditional automatic conflict recovery,
  corrective-record resolution, filing investigation, outside evidence and fencing, and the complete
  old-backup/new-hardware operational exercise remain queued. Cloud allocation production
  enablement still needs qualified custody, signing, subscription and continuity policies; the
  [manual recovery and explicit report adapters](developers/cloud-fiscal-allocation.md) select
  none of those defaults. Paper allocation does not require a subscription.
  [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04).

- **Cloud fiscal reporting has no running host caller yet.** The adapter can collect a committed
  activation and send its retained report, but reporting is an explicit API call. Choose an
  authenticated operator entry point or background duty before promising unattended reconciliation.
  The calls are qualified in `apps/server/src/cloud-fiscal-allocation.test.ts` and the separately
  owned Cloud joint suite; neither starts a production reporting worker.

- **Allocated standby adoption still needs the primary's venue copy and fresh establishment
  authority.** The bundle can reserve a signed identity, but the public adopter refuses that
  allocation module before writing; no shipped entry point establishes its standby identity.
  Complete the copy and authenticated establishment path before presenting a successful fiscal
  join. The pending file alone supplies no live authority. Spec §9.4 permits the current refusal;
  [detail](backlog/fiscal.md#w41s-4-adoption-boundary-checkpoint-2026-10-14).

- **Still open after W41s-3 (#1289): one reply can open up to 1,000 filing cases.** A refusal
  that applies to every later record (one about the taxpayer's identity, say) opens one case per
  record in that reply before the repeated-code brake takes effect (`MAX_REGISTROS_POR_ENVIO`).
  [Detail](backlog/fiscal.md#still-open-after-w41s-3-1289-one-reply-can-open-up-to-1000-filing-cases)

- **Follow-up (W41s Task 8, held-record resolution): release a brake hold (send the held records
  again).** — left open by W41s-3b (#1303). Task 8 as planned resolves records that have a case of
  their own; a record the brake holds has none. The hourly retry in
  [#1309](https://github.com/clintongormley/waitron/pull/1309) releases eligible brake holds after
  an accept or a different-code refusal. A manual release remains Task 8.
  [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

- **Still open after W41s-3c (#1304)** — no run against real AEAT has shown that a cancellation's
  reply line names the cancelled invoice.
  [Detail](backlog/fiscal.md#w41s-fiscal-prevention-and-offline-recovery--design-and-revised-plan-approved-2026-10-04)

- **Re-examine the hold behind an unknown outcome once the asesor answers** — OPEN (waiting on the
  asesor; owner 2026-10-06). The decision is put to the asesor as
  [Q47](compliance/asesor-questions.md#q47-keeping-a-chains-later-records-unsent-added-2026-10-12)
  (S19 in the short list), covering this hold and the three-refusal brake. The holds after a 3000
  conflict and behind a cancellation of a refused invoice were dropped on 2026-10-12 (owner).
  [Detail](backlog/fiscal.md#re-examine-the-hold-behind-an-unknown-outcome-once-the-asesor-answers)

- **For Task 9 (the filing screen):** `listFilingCases` reads every case and event with no filter or
  paging, and `heldRecords` reads every `rechazado`/`detenido` row; neither has a production caller
  yet, so the screen should add an open-only filter or paging when it calls them. From W41s.

- **`FiscalBackend.pendingCount` leaves out set-aside (`retenido`) records**, as it leaves out held
  (`detenido`) ones, so neither counts as unconfirmed there. It has no production caller yet (see
  the `pendingCount` entry above); decide what "unconfirmed" includes before anything reads it.
  Left open by #1596.

- **The reconcile sweep may raise a second "accepted with errors" warning** when it corrects a
  record the drain is still sending (`packages/fiscal-verifactu/src/reconcile.ts`); only one case
  opens, as cases are one per record. Found by reading in #1596's review, not run; nothing runs the
  sweep yet, so check it when the sweep is scheduled.

- **The test "does not send a successor past a cancellation held for its original"**
  (`packages/fiscal-verifactu/src/drain.test.ts`) still reads like the old hold. It is true for the
  first pass it checks, but since #1596 a cancellation of a refused original is set aside and holds
  nothing: retitle it on the next touch.

- **A 0.00 simplified invoice:** B17's departure, and since B28 (#1005) Pay on a bill whose total is
  zero, file one; whether AEAT accepts it was not tested. Left open by service Task 17 (#991, a
  table that leaves without paying).

- **A845. The cancel of an invoiced bill checks the permission before its payment refusals**
  (owner decision, 2026-10-17). Like the drawer, refund and unpaid-departure routes, the cancel
  answers "not permitted", with the PIN checked and counted, before any payment refusal. Move the
  check, and prove both orders by running them: no permission and a payment held answers "not
  permitted"; permission and a payment held answers the payment refusal. Then correct the C126
  detail's "neither checked nor counted" sentence. FULL review (auth and permissions, fiscal path).
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **Loose ends left by C126 (cancelling an order whose invoice was issued credits it, #1030).**
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)
  - **`GET /api/cancel-credit-authorizers` (B33) lists the active holders of `sale.rectify`.** Every
    role holding `sale.rectify` today also holds `sale.refund`, `sale.void` and `cash.drawer`, so
    its cases cannot tell which of those it reads.
  - **C132 (landed as #1060): a credit note's line names the invoice line it reverses.** Open, for
    partial corrections only, which no product code makes yet (only tests and demo scripts do):
    whether a line a correction ADDS stays unlinked, and whether two adjustments may name the same
    invoice line. When a report starts reading the link it will want an index on the column.
  - **A fully credited bill's original invoice can still be reprinted**, from the till and from the
    dashboard; the server allows it. Whether a reprint should say the invoice was credited is not
    decided.
  - **An invoice that already has a correction cannot be cancelled.** No route issues a credit note
    other than this one.
  - **The credit note is not printed** for the customer (asesor Q32 (b)).

- **Asesor questions to send:** Q27 (money before the invoice, then a split; printing the invoice
  first), Q28 (unpaid departure; built on the owner's decision, asked to confirm), Q29 (how a
  discount or comp appears on the invoice) and Q32 (a cancelled, already-issued ticket: credit or
  annul; built on the owner's decision). Q19 stays open.
  [Detail](backlog/fiscal.md#asesor-questions-to-send)

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

- **One original per invoice, structurally.** F2 requests to `POST /api/sales/:id/receipt` still
  have no limit or idempotency; two calls produced three unmarked originals, and art. 14.1 says
  exactly one. **Remaining:** contain repeated F2 requests per sale, with the invoice number on the
  slip. [Detail](backlog/fiscal.md#one-original-per-invoice-structurally)

- **A795 — installing or renewing the AEAT certificate after setup: DESIGNED, waiting on three owner
  questions.** Only the setup wizard can set it (`apps/server/src/setup-api.ts`), and nothing watches
  when it expires. Against a test server that refuses an expired certificate during the connection,
  the filing pass treats it as a network failure, so only the four-hour delay alert fires; that AEAT
  refuses the same way is assumed. The [design](superpowers/specs/2026-10-18-a795-aeat-certificate-after-setup-design.md)
  puts a card on Venue settings → Venue details, checks file, passphrase, dates, tax ID and a
  read-only AEAT query before replacing, records every install, and adds expiry alerts. Open: who
  may replace it, when the warning turns amber and red, and whether the box emails. FULL review; the
  owner lands it. [Detail](backlog/fiscal.md#installing-or-renewing-the-aeat-certificate-after-setup)

- **A853. The box makes a company seal's private key itself** (decided out of A795, 2026-10-18).
  FNMT issues a seal only for a key pair and certificate request made on the subscriber's machine,
  and never issues a `.p12`; setup and A795 both take only a `.p12`, so today a seal's key must be
  made elsewhere and moved to the box. Design one flow for setup and renewal: the box makes the key
  and request, the owner pastes the request into FNMT's form, and the box takes back only the issued
  certificate. Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a853-the-box-makes-a-company-seals-private-key-itself)

- **VAT at line add (M7v, A68).** — left open by the menus plan. Asesor Q26 (the rate on the day of
  issue) is open. The till computes a basket VAT split (`vatBreakdown`,
  `apps/till/src/state/working-order.ts`) that no screen shows.
  [Detail](backlog/fiscal.md#vat-at-line-add-m7v-a68)

- **A802 — correct part of a paid invoice: READY TO QUEUE (owner, 2026-10-18).** Nothing in the
  product can issue a corrective invoice (R5, _factura rectificativa_) for part of an issued
  simplified invoice: the engine exists and only the whole-order cancel uses it. Staff need an easy
  way to correct a paid receipt when a customer spots an error afterwards. Build on today's
  filing-by-differences now; asesor Q31 may switch the filing type later without changing the
  screens. Needs a spec first; fiscal, so owner sign-off at land. A758 §3.8 (food cancelled on a
  paid bill, with a Refund tick per dish) refunds the ticked dishes through the ordinary refund and
  recommends that A802 issue their partial correction in the same step; its §3.8.1 has a worked
  example to check against.
  [Detail](backlog/fiscal.md#nothing-in-the-product-can-issue-a-corrective-invoice-r5-_factura-rectificativa_-for-a-vat-error-on-an-issued-simplified-invoice)

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live
  filing.** The 2026-10-09 research found the only 0% rate in the VAT Law is art. 91.Cuatro, goods
  donated to non-profits; the 0% on basic foods ended on 30 September 2024. The advisor is asked only
  to confirm (review item [R3](compliance/asesor-questions.md#the-shortened-list-2026-10-09)).
  **Non-blocking while pre-production; blocking before going live.**
  [Detail](backlog/fiscal.md#no-tax-0-is-an-open-fiscal-question-and-it-must-be-answered-before-the-first-live-filing)

### The setup wizard, onboarding and the demo venue

_Formerly A2 and B1._ Detail: [backlog/setup.md](backlog/setup.md).

- **Loose ends left by A496 (moving to a new tax ID).**
  - How long, and in what form, an old taxpayer's database must be kept. Not checked;
    `deploy/README.md` → _Moving to a new tax ID_ says so.
  - The new-tax-ID procedure cannot tell the operator when the old box has sent its last sales to
    AEAT. Step 3 of `deploy/README.md` → _Moving to a new tax ID_ keeps the box on so it can; the
    only signal it names is the delay alert (`fiscal.submission_delayed`), raised after four hours.
  - A change of country cannot import a configuration. Setup refuses an export whose country
    differs from the new venue's (`provision`, `apps/server/src/boot.ts`); importing across
    countries needs its own design.
  - The dashboard shows the configuration export card where the export route is not served, so its
    download fails there: on a demo box, and on a box whose settings name no onboarding intent, such
    as a promoted mirror (`persistTradingEnv` writes none). The route is mounted only when the
    intent is preparation or live (`apps/server/src/boot.ts`).

- **A852. Setup accepts certificate files filing cannot use** (found by A795's design). The wizard
  never opens the file, so a wrong passphrase, a file that is not a certificate, one with no private
  key and an expired one are all accepted; a preproduction setup seals them as given. A
  production setup needs its fiscal test to pass, which the first three cannot (their connection
  fails before it reaches AEAT; for a wrong passphrase the test says "uncertain, retry"); that AEAT
  refuses an expired one is assumed.
  [Detail](backlog/setup.md#a852-setup-accepts-certificate-files-filing-cannot-use)

- **`#onGoto` in `setup-app.ts` keeps `fiscalTestStatus`** — found by #567 while pruning comments.
  Several small wizard leftovers remain: a fiscal-test banner that may outlive its screen, an
  earlier attempt's message a cloud restore may show, a mistyped adopt answer, the mode screen's
  text about live filing, test titles and gaps, and a non-`wt-*` event name.
  [Detail](backlog/setup.md#ongoto-in-setup-appts-keeps-fiscalteststatus)

- **Loose ends left by SQLite slice 2 Task 9c (#646, "Restore from my bucket" in the setup
  wizard).**
  - The bucket route answers a wrong key (`recovery.passphrase_invalid`) and a damaged copy
    (`backup.artifact_invalid`, `backup.archive_invalid`) with different codes; the wizard shows
    one sentence for all three, as the command line does.
  - The first, unconfirmed attempt downloads the whole copy only to show whose it is, and the
    confirmed attempt downloads it again; the HTTP request stays open for the whole download.
  - Walked in the browser test harness against a stubbed server, not yet on a running box. Walk it
    on the box after 2 November: back up a test venue to a real bucket, wipe it, and restore it
    through setup.
  - After an archive restore or a Cloud restore the final screen does not show the device steps the
    bucket rebuild's shows (`rebuilt` is set only on the bucket path,
    `apps/setup/src/setup-app.ts`), although the first start re-issues the certificate for this
    machine's addresses after an archive restore too.

- **A832. Check whether a refused Cloud restore clears the "old server is stopped" tick.** Left
  open by #646. One browser run: refuse a Cloud restore and look at the Cloud screen's "old server
  and surviving peers are stopped" confirmation. If the tick clears, keep it ticked after a
  refusal; if it already stays ticked, delete this entry.

- **The name-constrained-CA model does NOT protect a personal Android phone** (spike 2026-09-08): a
  user-installed root is trusted for every name on Android, while desktop Chrome and iOS/Safari honour
  the constraint. The service-worker/PWA/WebAuthn-blocked-until-trusted behaviour and an iOS device
  are still to measure. [Detail](backlog/box.md#box-image-constraints-b3)

- **Android/iOS on-device install and trust rows** — real phones on the shop WiFi, the owner's to
  run. [Detail](backlog/setup.md#androidios-on-device-install-and-trust-rows)

- **A Demo's "Casa Delgado" stays in the draft when the operator switches to Prepare or Live**
  (whether this is wanted is not recorded; it sits among the wizard's constraints). The location
  name is not on the list leaving Demo clears (`#onPatch`, `apps/setup/src/setup-app.ts`).
  [Detail](backlog/setup.md#setup-wizard--the-constraints-a2s-rework-left-behind-a2)

- **OWNER DECISION, open since #443: should the setup wizard still OFFER "Add a mirror node"?** But
  the option is still there and the flow still runs, so an operator can still spend a box on it.
  Removing or disabling it until slice 3 lands the replacement is a product call, not a wording one.
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

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

- **The Cloud restore screen shows capture and expiry times as the server's raw ISO text** in both
  languages. Left open by C42 (#837).

- **Loose ends left by #334.**
  - The certificate export help has never been followed on a real machine. Nobody exported a
    certificate through Windows', macOS' or Firefox's own certificate store while reading the new
    guidance, so the instructions are unverified against the thing they describe. The Spanish
    steps name Chrome, macOS and Firefox menus from memory ("Gestionar certificados importados de
    Windows", "Acceso a Llaveros", "Sus certificados"…), and the FNMT links open FNMT's English
    pages but for macOS's (A834); check them on real Spanish systems at the same time (left open by
    C42, #837).
    [Detail](backlog/setup.md#the-certificate-export-help-has-never-been-followed-on-a-real-machine)
  - Switching setup mode does not clean up what the server already holds. If someone fills in
    Demo, Prepare or Live far enough that the server has stored part of that answer and then
    switches mode, what the server kept is untested — write a test that stages configuration in
    one mode, switches, and asserts what survives.
    [Detail](backlog/setup.md#switching-setup-mode-does-not-clean-up-what-the-server-already-holds)
  - The setup app's catch-all redirect was not proven by deleting it. The reviews checked this by
    running the route tests and the full server suites, not by removing each exclusion one at a
    time and watching a test fail, and no separate probe confirmed the trading app is untouched by
    the redirect.
    [Detail](backlog/setup.md#the-setup-apps-catch-all-redirect-was-not-proven-by-deleting-it)

- **A fiscal test or a provision that answers after the wizard has been removed from the page
  leaves it stuck when it is put back** — found while bringing `apps/setup` to the coverage bar
  (2026-09-23), left unfixed. The app mounts the wizard once and never removes it, so this may be
  unreachable in use.
  [Detail](backlog/setup.md#a-fiscal-test-or-a-provision-that-answers-after-the-wizard-has-been-removed-from-the-page-leaves-it-stuck-when-it-is-put-back)

- **Loose ends left by C47s (#840): Demo gaps on the setup wizard's venue screen, left unfixed.**
  - In Demo, a server refusal of a field Demo hides can only be retried unchanged. Whether the
    server ever refuses Demo's fixed series codes is not established.
    [Detail](backlog/setup.md#in-demo-a-server-refusal-of-a-field-demo-hides-can-only-be-retried-unchanged)
  - In Demo, a local check that fails only on a field Demo hides. All of this was read in the code,
    not run; whether a real draft can reach that state has not been tested.
    [Detail](backlog/setup.md#in-demo-a-local-check-that-fails-only-on-a-field-demo-hides)

- **A833. Setup, and the demo, start only for a country that has a country pack** (owner decision,
  2026-10-17). The country choice offers only countries with a pack (Spain today); a country without
  one is not offered at all. The venue screen offers only `VENUE_SETUP_COUNTRY_PACKS`, marks a
  country with no pack invalid, and no longer shows "Invoice settings have not loaded yet." for one
  (`apps/setup/src/screens/venue-screen.ts`); the server refuses one in every mode (`parseVenue`,
  `apps/server/src/setup-api.ts`). Read, not run. One browser test seeding a draft with a country
  that has no pack, plus one request test: if both refuse, delete this entry; if either does not,
  fix it.

- **A834. Point the certificate export help's macOS link at FNMT's English page.** In
  `apps/setup/src/certificate-export-help.ts` the macOS guide's link opens FNMT's Basque `/eu/`
  page, while the Windows and Firefox links open `/en/`. Change it to `/en/`, or to the person's
  language where FNMT has a page in it. Done when each of the three links has been opened and shows
  the right language.

- **A missing configuration export on the setup wizard's live-source screen gets no red ring.** The
  backup restore screen's file input draws one (A523); `live-source-screen.ts` marks its file input
  `aria-invalid` but has no style for it.

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
  stay English under Spanish staff-facing dish names (the plan's known limit).

- **A835. Check whether the demo's stored practice sales can be reprinted and looked up on the
  till.** W109-5's Barcelona look read that both look a sale up through its till order, which a
  practice sale does not have; nobody checked it against the code. One run on the demo: if it is
  real, seed those sales with till orders like real sales so reprint and look-up work; if both
  already work, delete this entry.

- **The demo’s Catalan and Galician text needs a speaker’s check** (W109-3, #1321,
  owner decision 4, 2026-10-06). A speaker of each
  should read it. The demo's Drinks section labels in Catalan and Galician are drafts awaiting the
  same check, left open by A321 (the demo's included Drinks menu opens onto four sections).
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

- **`pnpm dev:reset` deletes the venue folder before it refuses `WAITRON_ENV=production`.**
  `apps/server/scripts/dev-setup.ts`'s `main()` calls `resetVenueDir` under `--reset` before
  `devSetup` reaches `demoSeedEnvironment`, against the file's header. Fix: the same check at the
  top of `main()` that `dev-onboard.ts` has. Found by A680.

- **Loose ends left by A680 (#1718).**
  - The setup wizard has no text for `sif.throwaway_allocation_refused`. A box started with
    `WAITRON_ENV=production` still offers Demo and Preparation
    (`apps/setup/src/screens/mode-screen.ts` shows only a production warning), and either one is
    refused with that code, so the operator sees the wizard's generic failure (its plan's D6).
  - Demo and Preparation can be set up by anyone who reaches the setup wizard first, as before
    #1700. Neither needs a supplied allocation since A680, so on a shared network a stranger can
    set up an unconfigured box in either mode before its owner does. Only a preproduction venue can
    come of it (its plan's unsure point 2).
  - The throwaway-allocation seat names a Spanish term in a country-neutral contract:
    `ModuleProvisioning.throwawayAllocation.prepare` takes `taxpayerNif`
    (`packages/module/src/provisioning.ts`); finish-branch's convention review asked for `taxId`.
    Left as is because the English-only guard allows "NIF" and lane E's A679 was given this exact
    shape, so a rename changes both. Owner's call.
  - The route tests in `apps/server/src/setup-throwaway.route.test.ts` are named after its plan's
    table ("cell 1" … "cell 14"), which goes when plans are deleted at go-live, and the file does
    not follow its siblings' `setup-api.<topic>.test.ts` pattern. Rename both to describe the
    behaviour.
  - Whether a throwaway venue can get an offline recovery pack is untested. #1717's recovery pack
    checks the allocation's recipient venue; a reviewer read that a throwaway venue would probably
    be refused one, which fits a practice-only venue, but nothing ran it.

- **A fresh Demo venue opens its dashboard on a red tax-filing alert** (`fiscal.submission_delayed`
  over the demo seed's back-dated sales). Found by A680.
  [Detail](backlog/setup.md#a-fresh-demo-venue-opens-its-dashboard-on-a-red-tax-filing-alert)

### Menus and the catalogue

- **Menu prices' narrow-layout CI failure still needs a cause (A613).** The existing
  assertion failed in main run 38505417966. macOS whole-file, coverage-shard, CPU and delayed-font
  probes did not reproduce it; the assertion and timeout remain unchanged. On its next failure,
  read the attached viewport, table/scroll dimensions and font snapshot before choosing a fix.
  [Investigation](backlog/ci.md#menu-prices-narrow-layout-ci-failure-still-needs-a-cause-a613)

- **Modifiers' Spanish "Opciones" tab was cut at a 310 px screen on CI's Linux fonts** in
  A424 (#1452). A434's macOS Chromium probe measured the whole tab at screen widths 310 and
  390 px (tab 95.67 px; strip 106.42 and 186.42 px). The owner has not ruled on Modifiers;
  reproduce with the Linux fonts before choosing a change. The Printers tab's shorter label
  was the separate A434 ruling.

- **A884. Deleting an options or extras list leaves it on the published menus until they are
  republished.** Until then the till cannot add a dish carrying a deleted options list, nor save a
  change to a parked order that keeps one (`options.label_required`); after a republish, a table's dish carrying an
  extra from a deleted list cannot have its quantity raised (`extras.invalid`).
  [Detail](backlog/catalogue.md#a884-deleting-an-options-or-extras-list-leaves-it-on-the-published-menus-until-they-are-republished)

- **A885. Say that lines already on an open order keep their VAT class after a republish.** The
  VAT help and the Products guide say only that a class change reaches the tills at the next
  publish. [Detail](backlog/catalogue.md#a885-say-that-lines-already-on-an-open-order-keep-their-vat-class-after-a-republish)

_Formerly the catalogue and menus entries in the opening part of the old Track A (before A1), and the catalogue entries filed under A2; part of A9._ Detail: [backlog/catalogue.md](backlog/catalogue.md).


- **Repeated allergen kinds from direct callers.** The allergen validator accepts, for example,
  `{ gluten: { kinds: ["wheat", "wheat"] } }`; the dashboard picker and published derivation remove
  repeats. A668-1's Claude probe recorded that result. Decide whether direct declarations should
  be refused or normalised, then check both ingredient and product requests with repeated kinds.

- **A670 — printed menus (owner, 2026-10-14; open, not designed).** Waitron prints no menu today.
  A printed menu carries each dish's allergen icons after its name and a key on the page naming
  every icon (the regulation wants words, with symbols only in addition — A668's _Sources_). With the
  online menu (A509) it is the written allergen record a customer or inspector is shown, now that the
  till no longer offers a separate Allergens screen.


- **A655 — fewer and slimmer columns on Products (owner, 2026-10-14; open).** In
  `apps/dashboard/src/widgets/product-list.ts`: "Standalone ordering" gets a shorter heading,
  Allergens and Dietary info start hidden (`choosable: "hidden"`), and Made at is deleted, or at
  the very least loses the grey second line under a category's station. **Added 2026-10-16
  (owner):** a Course column and a Course filter join the list.
  [Detail](backlog/catalogue.md#a655--fewer-and-slimmer-columns-on-products)

- **A product in more than one category (owner 2026-10-10, A461 amendment 4).** Define the
  storage, editor and what Move/Remove do to memberships. Products currently has one category;
  A461 shows existing placements only. This work is not queued.

- **The Products tree's hidden counts may be placed against the page at narrow width** — not
  measured; left open by A453. At 440px or less the tree hides its counts visually
  (`wt-data-table[narrow]::part(count)`, `apps/dashboard/src/widgets/product-list.ts`) as the menu's
  Structure tab does. A453 found the Structure tab's hidden root count was positioned against the
  page, not the table's scroll box, and gave its root label `position: relative`; Products' root
  label has no such rule. **Next action:** measure at phone width with a long name before changing
  anything.

- **On a phone, sections nested more than four deep read flat in the Structure tab** — left open
  by A453. At narrow width `wt-data-table` stops indenting after four levels
  (`min(var(--tree-depth, 0), 4)`, `packages/ui/src/components/wt-data-table.ts`), and the menu's
  root row now takes one of them. A453's look at 390px wide: level 4, level 5 and a product in
  level 5 all start at the same x. **Next action:** the owner decides whether the phone indent
  should go deeper (a shared table rule, so the Products tree changes too).

- **Menu-root default fallback when content languages are unset (A420 review).**
  `updateMenuDetails` validates against English; section and include-folder writers use
  their supplied venue fallback. Decide whether the menu-root writer should take that
  fallback too. `content-translations.test.ts`, “existing menu, section and folder checks
  expose the unset default fallback”, exercises the difference. Inline saves already use
  their resolved venue context.

- **Translation report excludes image names (C122, #1006).** The media module's
  `contentTranslations` seat supplies only a kind and an id. Showing a name or editor link needs
  a separate seat design that respects module boundaries; no change is queued.

- **Sections lack direct editor addresses (C122, #1006).** The report links a section to its
  menu's Structure tab. A420 part 2 replaces that journey for translation edits; other section
  navigation still needs its own decision.

- **The `media_images` filename CHECK accepts a name with an embedded NUL**: the review stored 64
  hex characters, `.png`, a NUL and `evil` (73 bytes) on `node:sqlite`, because `substr` stops at
  the NUL; closing it needs a migration. Found by #609 (`packages/media`), not fixable in a
  comments-only change.

- **`writeItems` and `writeLabels` each keep a refusal after their insert that looks unreachable
  now** — OPEN (found by #603). Read only, not run: `writeItems` (`packages/catalogue/src/extras.ts`)
  and `writeLabels` (`src/options.ts`); duplicate and foreign ids are refused earlier and one write
  runs at a time.

- **`MAX_MODIFIER_INTEGER` and the extras contract's `whole` bound have no stated reason on this
  engine** — OPEN (found by #603). Read only, not run: both were PostgreSQL's integer maximum.
  [Detail](backlog/catalogue.md#max_modifier_integer-and-the-extras-contracts-whole-bound-have-no-stated-reason-on-this-engine)

- **`assertRefsExist` still reads lists in sorted key order** — OPEN (found by #603). Read only, not
  run: that order (`packages/catalogue/src/product-modifiers.ts`) served PostgreSQL's lock ordering
  only.

- **Three configuration-transfer cases pin an insert order the importer's `pragma defer_foreign_keys`
  may make unnecessary for foreign keys** — OPEN (found by #603). Read only, not run: in
  `packages/catalogue`'s `options.test.ts`, `product-modifiers.test.ts` and `extras.test.ts`;
  whether to keep pinning it is the owner's call.

- **Test titles in `packages/catalogue` a comments-only change cannot touch** — OPEN (found by
  #603). Four titles, in `dietary.test.ts`, `product-modifiers.test.ts` and `migrations.test.ts`.
  [Detail](backlog/catalogue.md#test-titles-in-packagescatalogue-a-comments-only-change-cannot-touch)

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

- **A case the content-language decisions leave open, built with the plan's default unless the owner
  says otherwise** (plan, "Open points"): receipts outside Catalonia stay free, Spanish by default.
  Left by W109 (#1320, #1322); the decisions are in
  [products.md](developers/products.md#content-languages-per-region). The other open case, a
  Spanish venue with no known province, is settled (owner, 2026-10-17: Spanish is required
  everywhere; relayed to A682).

- **Loose ends left by W87 (#1191).**
  - Between 30rem and 50rem a long menu name can still make the Menus table wider than its box, so
    the end of the live version's time scrolls under the pinned Actions column; the link and the
    row menu stay in view.

  [Detail](backlog/catalogue.md#menus-list-changes-column-and-top-aligned-rows-w87-1191-left-open)

- **A menu's Structure tab is one tree (W88, #1209): not checked** — in Spanish at 390 px the Type
  column scrolls partly under the pinned Actions column, which is the table's own sideways scroll;
  the heading's height with "Checking…" or "Could not be checked" was not measured against the other
  states.
  [Detail](backlog/catalogue.md#a-menus-structure-tab-is-one-tree-w88-1209-not-checked)

- **A547 — Preview tab: "Publish later" sits to the left of "Publish now", and "Scheduled versions"
  shows only when something is scheduled** (owner, 2026-10-12). Wanted: the two buttons on one
  line, Publish later first; the heading and table drawn only while at least one version is queued.
  [Detail](backlog/catalogue.md#a547--preview-tab-publish-later-sits-to-the-left-of-publish-now-and-scheduled-versions-shows-only-when-something-is-scheduled)

- **Loose ends left by W89 (#1239).**
  - Not checked: the Price overrides tab on the running dev stack — a real save and the re-read
    after it, and Undo against the real server (the look in Chromium used mounted widgets only).
  - A size with its own price decides whether its clash comes from its product by matching the two
    clashes, which can be misread in a rare setup where they match exactly — telling them apart
    needs the prices read to say which level a clash came from. Raised in #1239's review and not
    taken.

  [Detail](backlog/catalogue.md#a-menus-prices-are-one-editable-price-overrides-field-per-row-w89-1239-left-open)

- **Loose ends left by W92 (#1250).**
  - In the Structure tree, closing the section form opened from a section's swatch puts focus on
    the row's ⋮ menu rather than back on the swatch that opened it. No test pins it.
  - At 390 px the Structure tree clips a long product name under the pinned Actions column, so a
    long name's swatch needs a sideways scroll to reach; since A294 this no longer applies to
    sections, and it stays open for products.

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

- **A Home page tab product shortcut reached only through a disabled included menu reads "Not
  shown: not on sale on this menu"**, where a section shortcut in that place reads "Not shown: in a
  disabled included menu" (`#hiddenReason`, `apps/dashboard/src/widgets/device-home-preview.ts`).
  Left open by A816 (#1880).

- **A Home page shortcut's bin button stays live while a shortcut reorder or a display setting is
  being saved.** It is greyed only while a shortcut is added or removed: `#moveShortcut`
  (`apps/dashboard/src/screens/menus-screen.ts`) leaves the screen's `busy` flag unset so a
  keyboard user's focus stays on the grip, and display saves use their own flag. A815 asked for the
  button "greyed while a save is out"; decide whether a remove during a reorder save should wait,
  be refused, or is fine as it is. Not tried in a browser. Left open by A815 (#1880).

- **A switched-off menu's Home page tab would give every hidden shortcut the wrong reason**: each
  section reads "Not shown: nothing to order in this section" and each product "Not shown: not on
  sale on this menu" (`#hiddenReason`, `apps/dashboard/src/widgets/device-home-preview.ts`),
  measured by finish-branch's worker in a test. Nothing outside tests switches a menu off today
  (`deactivateCatalogue` has no other caller); revisit when something does. Left open by A816
  (#1880).

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

- **The Menus Structure tree notices silent branch closure by watching its table redraw — OPEN (W88).**
  An event from the table for "these branches changed" would be cleaner; it means a change in
  `packages/ui`.
  [Detail](backlog/catalogue.md#the-menus-structure-tree-notices-silent-branch-closure-by-watching-its-table-redraw--open-w88)

- **"Open <menu>" in an included menu's ⋮ can be followed while the tree is busy — OPEN (W88).** The
  other items in the tree's row menus are greyed out while a change is out; the link to the included
  menu's own editor is not marked `aria-disabled="true"` then, so it stays live (marked so,
  `wt-row-actions` would grey it out and cancel a click or middle-click on it). (A322 renamed it
  from "Edit <menu>", so that the include's own Edit could sit beside it.)

- **Loose ends left by A322 (#1372, an included menu can show its sections directly).**
  - A folder's fixed photo shows on the till only in Thumbnails mode, as a section's photo does.
  - A home shortcut to a menu that is included in two lists of one menu opens the top-level copy,
    else the copy indexed last.
  - Renaming or clearing the included menu's own customer names is not checked against the folders
    that fix some languages, so a folder can end up with no name in the default language. The
    missing-translations report lists it, and changing the default language is refused while it
    lasts, but the write that caused it is allowed.
  - A fixed value that happens to equal the included menu's value when the dialog opens is saved
    back as "follow" the next time the dialog is saved: the dialog compares with the included
    menu's value and cannot tell the two apart.
  - The live photo triggers for products and sections (media `0005` to `0007`) look up
    `products.image` and `sections.image`, which no index covers. Its own item: a performance fix
    with a media migration.

  [Detail](backlog/catalogue.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open)

- **Loose ends left by A380 (#1385).**
  - A configuration import stores a fixed folder name as given, spaces included, where a save
    through the dialog or the route trims it. A name of spaces only shows as no name either way.
  - After browser Back to another menu with no edits made, the include's Edit dialog stays open
    over that menu, as the section Edit dialog does: choosing another menu does not close either
    (read in `menus-screen.ts`, not run).

- **Loose ends left by W83 (#1193).**
  - A desktop window narrow enough to leave the Products table under 768px gets the full-screen
    Filters panel — at which window width that happens with the sidebar shown was not measured.
  - The Products 768px side-panel threshold is tied by hand to token sizes (768 − 7×44 − 12 = 448,
    just above the table's 440px narrow-tree width). Left open by W83's review, not started.

  [Detail](backlog/catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)

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

- **A person who may not read routing sees "Kitchen routing unavailable" on every category**,
  because a refused read counts as a failed one. Left open by W86 (#1203, a category's Made at).

- **One writer still skips the required-language check (`content.language_required`) — OPEN.**
  The Prepare-to-Live configuration copy (`packages/catalogue/src/configuration-transfer.ts`)
  copies the saved row as it is, unplanned. The demo seed
  (`apps/server/scripts/demo-seed/seed-catalogue.ts`) runs the check since W109-4 (#1322).

- **Translate all: run the end-to-end check on the Santet venue against a local Waitron Cloud once
  Cloud's side exists** (plan `docs/superpowers/plans/2026-10-14-translate-all.md`, Task 21; left
  open by A689's fifth PR). Cloud's `servicesVersion` 2 must be deployed before a box built from
  `main` talks to it ([cloud-connection.md](developers/cloud-connection.md)).
  [Detail](backlog/catalogue.md#translate-all-run-the-end-to-end-check-on-the-santet-venue-against-a-local-waitron-cloud)

- **Loose ends left by A689's fifth PR.**
  - Translate all: a "Use fix" button for a spelling fix to a name someone entered; it waits for
    the side-by-side translations dialog (plan Decision 6). Today the dialog shows such a fix only
    as a note on the item's row.
  - Alert wording writes numbers without a thousands separator (`formatParam`,
    `packages/dashboard-kit/src/alert-messages.ts`); the Translate all notice reads "1050
    suggestions".

- **Translate all: a venue with more than Cloud's 20 content languages gets a job Cloud refuses.**
  The box saves up to 200 languages and sends them all as `languages.enabled`; Cloud refuses every
  job past 20 with 400, which reaches the dialog as `cloud.request_invalid` (ruling W1b, A689's
  second PR). A box-side refusal before any job is built would say what is wrong.

- **Translate all: a job the box ends itself is marked released without a call to Cloud, and
  Cloud can still hold it.** A submit Cloud accepted whose reply was lost is the worst case: the
  box never learned Cloud's job id, so it could not release the job even once Cloud finished it.
  What would fix it is open.
  [Detail](backlog/catalogue.md#translate-all-a-job-the-box-ends-itself-is-marked-released-without-a-call-to-cloud-and-cloud-can-still-hold-it)

- **Translate all: open points from the review of A689's second PR.** (1) A suggestion's
  out-of-date check starts from the item as it stood when the results were stored, not when the
  job was sent. (2) A waiting placeholder stops every later run from asking for that item until
  someone discards it. (3) A variant whose product's staff name is over 500 characters is sent with
  no product as context. (4) A venue with Valencian (`ca-ES-valencia`) enabled would have every job
  refused by the fake Cloud. Not run against Cloud.
  [Detail](backlog/catalogue.md#translate-all-open-points-from-the-review-of-a689s-second-pr)

- **Translate all: the notice's count can be higher than what the dialog shows.** `waiting`
  (`readSuggestionRun`, `packages/catalogue/src/content-suggestion-jobs.ts`) counts every stored
  suggestion with text, including out-of-date ones, ones for deleted items or switched-off languages,
  and ones left from an earlier run. Opening the dialog clears the notice, which limits the effect.

- **Translate all: three limits the translations dialog accepts for now (A689's fourth PR, 2026-10-15).**
  A Discard whose delete request never answers keeps Save disabled, across closing and reopening the
  dialog, until the page is reloaded, and nothing says why: a delete has no time limit (only reads
  do, `packages/dashboard-kit/src/request.ts`).
  [Detail](backlog/catalogue.md#translate-all-three-limits-the-translations-dialog-accepts-for-now-a689s-fourth-pr-2026-10-15)

- **The translations dialog capitalises a language name mid-sentence in Spanish in two older
  places** — `translations.default_needed` ("…predeterminado en Inglés…") and the table's
  accessible label `content_gaps.table` ("Sin traducir al Inglés"): both go through the dialog's
  `#name`, which passes `standalone=true` by default
  (`apps/dashboard/src/widgets/content-translations-dialog.ts`). Fixing
  them changes existing test assertions.

- **`joinCustomerPresentationText` passes the requested language where the default belongs — OPEN
  (found 2026-10-02 by A172, not measured).** The order path freezes the variant's text in the
  default content language, under every receipt-language key, before it gets there
  (`defaultLanguageDescriptions`, called by `priceOrderLines` in
  `apps/server/src/working-order.ts`), so whether any surface shows the difference is unknown;
  reproduce before fixing. [Detail](backlog/catalogue.md#joincustomerpresentationtext-passes-the-requested-language-where-the-default-belongs--open-found-2026-10-02-by-a172-not-measured)

- **Language resolution follow-ons** — there is still no single shared rule: the receipt's
  `lineName` (`apps/server/src/receipt-document.ts`) and the kitchen ticket's `ticketName`
  (`apps/server/src/kitchen-print.ts`) try the exact language and then take the first stored one.
  [Detail](backlog/catalogue.md#language-resolution-follow-ons)

- **Product folders, menus that include menus, and prep station routing: partly built (design
  approved 2026-09-30).** The
  [design](superpowers/specs/2026-09-30-catalogue-menus-routing-design.md) is built in slices. The
  delete dialog counts the routing cells removed but lists no products whose destination changes,
  and **Move to…** changes folder ancestry without a routing preview.
  [Detail](backlog/catalogue.md#product-folders-menus-that-include-menus-and-prep-station-routing-partly-built-design-approved-2026-09-30)

- **Sales classification and the menus plan — what they left open.** `Product.categoryId` and
  `primaryCategoryId` always hold the same value.
  [Detail](backlog/catalogue.md#sales-classification-and-the-menus-plan--what-they-left-open)

- **A817 — the Structure tab's Select mode deletes sections in bulk** (owner, 2026-10-17: a bulk
  Delete for sections is wanted). Today Remove from menu stays disabled while a section the menu
  owns is selected, because such a section is deleted, not removed; each is deleted from its own
  row's ⋮. Done when a test selects two of the menu's own sections, deletes them in one action and
  finds both gone. Left open by A337.

- **A682. Translations: every missing name reported, all languages side by side
  (owner, 2026-10-14; design decisions closed, 2026-10-17).** The translations dialog shows one
  field per enabled language on each row. Translate all and its "Use fix" action use the same editor.
  At 16:25 the owner approved unit A: required staff name and abbreviation, all translations optional,
  with no automatic copying. At 16:40 the owner approved Spanish A: Save succeeds with blank Spanish
  customer text, Spanish stays enabled everywhere in Spain whatever the province, and gaps remain.
  The [dated design closure](superpowers/specs/2026-10-17-a682-translations-design.md#2026-10-17-closure-unit-a-and-spanish-a)
  authorizes planning and build. The [executable plan](superpowers/plans/2026-10-17-a682-translations.md)
  covers all five points and Use fix in one future PR. A fresh-context plan read is complete;
  field-specific fallback and additive-upgrade checks are explicit. **OPEN:** implementation and
  validation, respecting the plan's G/C/E reservations.
  [Detail](backlog/catalogue.md#a682-translations-nothing-required-every-missing-name-reported-all-languages-side-by-side-owner-2026-10-14)

- **Content languages and the image library (#339, #344) — what is left open.**
  [Operator guide](../apps/server/src/guide/en/content-and-images.md). **A new picture consumer has to add a real database
  reference, not just store a filename.** **The online language selector has nothing to select for
  yet.**
  [Detail](backlog/catalogue.md#content-languages-and-the-image-library-339-344--what-is-left-open)

- **The upload limit is 20 MB (owner decision 2026-09-23).** It bounds how large an upload the
  server will buffer; the decode is bounded by `MAX_INPUT_PIXELS` (100 million). What current
  phones produce has not been measured. Left open by photos shrunk on upload (#543).

- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.** `withTransaction` admits one write transaction per venue file
  (`packages/catalogue/src/categories.ts`, above `listCategories`). **Next action:** measure it
  before anyone widens category authoring to more concurrent editors. Left open by product
  categories (#340, [API and integration guide](developers/product-categories.md)).

- **Extras and Options — deliberate limits, and what is left open.**
  [integration contract](developers/modifiers.md).
  [Detail](backlog/catalogue.md#extras-and-options--deliberate-limits-and-what-is-left-open)

- **Image library (#547's review, `packages/media/src/dashboard/image-library.ts` and
  `image-picker.ts`).** (1) When the picker is handed a new live-data source, the library keeps
  listening to the first one until its next load. (2) The delete confirmation's Close button has no
  in-flight check of its own and relies on being drawn disabled. From "Review points left for the
  owner".
  [Detail](backlog/catalogue.md#image-library-547s-review-packagesmediasrcdashboardimage-libraryts-and-image-pickerts)

- **The Price heading reads "Price per portion" also over a row sold by the unit.** Still open from
  its review: neither screen counts a stored unit seeded as `each` as Each, which `isEachUnit`
  (`packages/catalogue/src/units.ts`) does; no code outside tests seeds one. Left open by W75 (the
  Extras editor shows Portion beside Price, #1194).

- **A name stored under a regional code such as `en-GB` is read by the forms as the plain code
  first, then its regional ones** (`languageText`, `apps/dashboard/src/widgets/form-fields.ts`). A
  till or receipt asking for `en-GB` reads `en-GB` before `en`, so a map holding both can show one
  name in the form and serve the other. Left open by W77 (#1197; W77a #1206).
  [Detail](backlog/catalogue.md#a-name-stored-under-a-regional-code-such-as-en-gb-is-read-by-the-forms-as-the-plain-code-first-then-its-regional-ones)

- **At phone width in a right-to-left layout, a long name in the Products list can run under the
  pinned Actions column** (`#fitNames`, `apps/dashboard/src/widgets/product-list.ts`, measures the
  room from the left). Found by A330's Codex review and reproduced by it on `main` before #1354. Not
  fixed; next: a browser test at 390 px with `dir="rtl"` and a long unbroken name. Left open by
  A330 (variant rows show their photo, #1354).

- **Loose ends left by A343 (a menu's Price overrides tab tidied, #1368).**
  - The Price overrides tab's save message comes after the whole table in tab order, so a keyboard
    user cannot reach Undo from a field within its 5 seconds (decided as built, not tested with a
    user). Options: a keyboard shortcut for Undo, or a message that waits while focus stays in the
    field it saved.
  - In Spanish a range's placeholder reads "8.00 – 12.00" with full stops, and a refused field is
    drawn about 14 px wider than the others (seen in #1368's screenshots). A344 removed the "?" and
    the Resolve column and keeps each price box on screen at 390 px; the wider refused field and
    the placeholder's full stops were not re-checked.
    [Detail](backlog/catalogue.md#in-spanish-a-ranges-placeholder-reads-800--1200-with-full-stops-and-a-refused-field-is-drawn-about-14-px-wider-than-the-others)

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version** —
  owner, 2026-10-07; PARKED, not queued — owner 2026-10-08: take it from here when a lane has room.
  Its work so far is on a LOCAL branch only — `feat/menu-preview-undo` at `e04b3abe7`, in the
  worktree `waitron-feat-menu-preview-undo` (no push, no pull request).
  [Detail](backlog/catalogue.md#a353--previews-changes-an-undo-link-that-puts-one-change-back-to-the-live-version)

- **Loose ends left by A347 (#1392).**
  - An imported bundle may carry priced menu rows for a product no menu reaches, and adding the
    product back to a menu revives those prices (found in A347's review, believed to predate it).
    Options: run `syncMenuOffers` over every menu after an import, or refuse priced rows no menu
    reaches.
  - A bulk Disable of 500 products could not read the count in A347's review (HTTP 431, because
    the ids go in the URL), so the dialog says "every menu"; the smallest count that fails was not
    measured. A435-1 (2026-10-09) renames the action Archive; the request still carries ids in the
    URL. The earlier 500-product failure has not been remeasured.
  - Deleting a category with its contents says its products come off every menu, with no count.

- **Loose ends left by A346 + A348 (a price this menu sets stands out, an Available column, and
  Edit product, #1408).**
  - At a 320px window only "12.50 – 15.00" was measured in a menu's Price overrides tab.
  - In the real dashboard at a 390px window the table is 358px wide (read once in the dashboard's
    test browser; no test pins it). Whether one-word names keep their line there while no field
    shows a range has not been measured. Options for more room: less page padding on phones, or a
    shorter Actions heading.
    [Detail](backlog/catalogue.md#in-the-real-dashboard-at-a-390px-window-the-table-is-358px-wide)
  - On the Structure tab at 390px the tree's own box scrolls sideways under the pinned ⋮, by
    design (`pinned: "end"`); in Spanish Disponible now sits wholly behind it until the tree is
    scrolled. Letting long names wrap at narrow widths may free the room; not tried.
    [Detail](backlog/catalogue.md#on-the-structure-tab-at-390px-the-trees-own-box-scrolls-sideways-under-the-pinned-)

- **A818 — retire `MenuPriceRow.active` and `MenuPriceVariant.active`** (owner, 2026-10-17). Both
  are always true since A347 (#1392) (`packages/catalogue/src/menu-types.ts`), so the dashboard's
  Inactive branches (`#active` and `activeOffer` in `apps/dashboard/src/widgets/menu-prices-table.ts`,
  the `active` conditions in `menu-price-inheritance.ts`) cannot be reached. Delete the two fields,
  those branches and the tests whose subject is an Inactive row. Done when the fields are gone and
  the package's typecheck and remaining price-table tests pass. Left open by A346 + A348 (#1408).

- **The reveal fix corrects only a row left under the headings.** A row revealed at the bottom edge
  is not corrected, and by the same whole-pixel rounding it can sit up to half a pixel past the
  bottom (left alone; not measured). Left open by A294 (the Products and Structure trees show drag
  grips only in a mode, #1300).

- **Loose ends left by A263 (#1151)** — OPEN, unqueued.
  [Detail](backlog/catalogue.md#what-1151-left-open-2026-10-03)
  - The database still accepts a maximum of 0 — the owner has not asked for it. The CHECK on
    `extra_lists` allows `max_picks = 0` when `min_picks` is 0, and configuration transfer copies
    stored lists without the request check, so a stored 0 can still arrive. Refusing it in the
    database is a table rebuild (CLAUDE.md §3's rebuild rule).
  - A very long number is cut off in the narrower box. The request check accepts up to 2147483647,
    which needs about 82px against the 66px between the buttons (measured by #1151's review). Left
    alone because widening the box would undo the size the owner approved.
  - At 390px the extras table's Price column runs past its scroll area's right edge until
    scrolled. (2026-10-04: W75 added a Portion column and widened the table; not re-measured.)

- **In the product editor's Descriptors fold at 390 a long English description fills both of its
  lines** — looked at 2026-10-03, after A200 (#1076): so the Spanish one does not show at all on
  the closed line.

- **Open test gap from A201b** (#1091): the suite does not establish whether `#closeLostList()` in
  `#includeMenu` catches a list disappearing between the last read and selection. Check that race
  with a focused test, or remove the guard if the path cannot occur; its reachability remains
  unverified. [Detail](backlog/catalogue.md#open-test-gap-from-a201b-1091)

- **Past sales of a variant that had a category of its own now show under its product's
  category** — left open by A209 (#1090): in the category sales report's "Current categories"
  mode (`current`, `packages/reporting/src/category-sales.ts`), which classifies each line by the
  catalogue as it is today; "Categories at time of sale" still reads what each line recorded.

- **A configuration import copies `products` rows as they are** — left open by A209 (#1090):
  (`select *` in `apps/server/src/configuration-transfer.ts`, from `CORE_CONFIGURATION_TRANSFER`
  in `packages/db/src/configuration-transfer.ts`), so an imported variant can arrive with a stored
  category that the effective category and the editor's read then ignore.

- **The course dropdown says "— none —" where the folded Kitchen line says "Course: None
  specified"** (`product.no_course`, `modifiers.none_specified`,
  `apps/dashboard/src/i18n/strings.ts`) — left open by A211 (#1096).

- **The catalogue-screen test "ignores the closed window's late close…" catches its guard's
  removal only through an unhandled error** — left open by A212 (#1087): because the late close
  throws before it changes anything a state assertion could see.
  [Detail](backlog/catalogue.md#catalogue-course-window-late-close-guard)

- **Each list still reads "Extra bread · Extras", and under its heading the " · Extras" is now
  said twice** — left open by A218 (#1082).

- **With three lists the dropdown already scrolls, so "+ Add options list…" sits at or just below
  its bottom edge when it opens** — left open by A218 (#1082).

- **In Spanish the folded line reads "IVA: Reduced (10%)"** — left open by A219 (#1065). The VAT
  class name is the stored label, which `taxLabel` shows untranslated, and on `main` before #1065
  the VAT dropdown already read it the same way. Where those labels come from, and whether they
  should be translated, is not checked.

- **Left open by #1188's review, none started** — the pricing unit dialog (W66, #1188).
  [Detail](backlog/catalogue.md#left-open-by-1188s-review-none-started-the-pricing-unit-dialog-w66)

- **In the wide Extras editor at 1280px wide, the items table scrolls sideways by 4px** — left open
  by W70 (#1222): (978px of content in a 974px box), with or without the size attribute.

- **At phone width the "All products" default colour cannot be set** — left open by A332 (#1430):
  at phone width every swatch slot is hidden except a category's name box while it is being named,
  and a category's row menu has no colour item, so the default cannot be set on a phone (owner
  2026-10-08: leave it until categories get a phone-width way in).

- **A refused default colour reuses `category.invalid {field:"color"}`, as the VAT default reuses
  `product.invalid`** — left open by A332 (#1430).

- **A category's naming square does not announce the inherited colour's source.** While you add or
  rename a category, its square says only "Choose the colour" even when its dashed border marks an
  inherited colour. The at-rest row names the source. Decide how the naming square should announce
  that source, including a category whose new name has not been saved, and check the English and
  Spanish accessible names. Found in A820's run-it review; the label and inherited fill are checked
  together in `apps/dashboard/src/widgets/product-list.test.ts` ("puts a colour square showing the
  box's colour").

- **Re-check whether these forms keep an edit’s unsaved state when taken out of the page and
  put back.** Left open after the unit-form fix in A397 part 2 (#1439):
  the ingredient form, the options list and its option window, the extras list, Add to menus, Add products, Schedule and Change time. It matters only if a
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
  marked row is about twice as tall as its neighbours. Also left open by A178g (#1021): at 390px the
  extras list form's item table runs past the dialog's edge, its headings cut ("Preselecc…"), seen
  in its LOOK, not changed and not checked against `main` before it (screenshots kept outside the
  repository).

- **From #541's review, neither blocking:** the product list shows a variant's blank price as its
  parent's with no marking (`apps/dashboard/src/widgets/product-list.ts`) — whether to grey it is
  the owner's call. [Detail](backlog/catalogue.md#from-541s-review-neither-blocking)

- **Review suggestions on the product editor not taken (Task 6):** split the editor's types into a
  product shape and a variant shape, derive `InheritedValues` from the product type, and write a
  parent's variant republishes in one statement. Nothing waits on them.

- **The product list.** A variant's name may sit a few pixels low at 390px, and
  `listedVariantsOfProducts` repeats `variantsOfProducts`' grouping.
  [Detail](backlog/catalogue.md#the-product-list)

- **A variant image usage's `productId` has no reader in the dashboard**
  (`packages/media/src/dashboard/client.ts`). **Next action:** drop the field, or say what it is
  kept for.

- **Loose ends left by A663 Part 2d (#1779).**
  - The dashboard lets a manager attach an extras list to a product sold in a unit with decimals or
    on a scale, and the till then offers no extras for it, with no word to the manager. Refuse it,
    or say so, in the product editor (`writeProductModifiers`,
    `packages/catalogue/src/product-modifiers.ts`, checks no unit).
  - A held order or a basket line carrying extras on a dish whose unit has since gained decimals or
    a scale is not flagged by the till. The held-order rebuild (`apps/till/src/till-app.ts`) and
    `lineBlock` (`apps/till/src/state/menu-refresh.ts`) still read the raw extras lists rather than
    `offeredListsOf`, so only the server's `extras.unsupported_product` stops it, and the till
    offers no way to drop just the extras. Read, not run.

- **A821 — one test: an extra on a dish sold in millilitres is refused** (owner, 2026-10-17). The
  owner's rule: extras go only on dishes sold in whole portions. Today's check (`soldByTheUnit`,
  `apps/server/src/working-order.ts`; its twin in `apps/till/src/widgets/product-name.ts`) refuses
  with `extras.unsupported_product` only a dish whose unit has a scale or allows decimal places,
  and a unit records nothing else about what it counts, so by reading a 250 ml dish whose unit has
  no decimals keeps its extras today (read, not run). Order an extra on such a dish: if it is
  refused, delete this entry; if not, a unit needs a way to say it is a measure rather than a
  portion, and the check refuses extras on one. Left open by A663 Part 2d (#1779).

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
  against a real database, and taking the result through the till. **Next action:** walk it once
  at the real box with the owner present, alongside **The displays and the printers walked at
  the real box** (_What to work on next_), after the owner is back on 2 November (owner,
  2026-10-17).

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

- **The kitchen and expo screens still show allergens as text chips.** A668 brings icons to the
  editor, the till's buttons and its order list, not to these screens.

- **The picker collapses on `focusout` alone** (`#finishEditing`). If the editor is reported
  snapping shut mid-selection, make the collapse depend on `relatedTarget`.

### Service periods, opening hours and departments

- **The departments list's "Also edit" column is empty on every row** (left by #1858, 2026-10-18):
  A504 (#1857) removed the zones' Floor plan link and #1858 the departments' Receipt link, so the
  column draws blank cells. Owner to decide whether it goes
  (`packages/venue-service/src/dashboard/departments-list.ts`).

- **A receipt refusal that names no field, arriving while another tab of the department dialog
  shows, brings nothing back** (left by #1858): it appears only in the receipt editor's own error
  line on the hidden Receipts tab. A refusal naming a field already brings Receipts back and focuses
  the field.

- **The department dialog reads the department's receipt as it opens, even if Receipts is never
  shown** (left by #1858). Reading it when the tab is first chosen would save the request, but
  design-system.md keeps hidden tabs loaded; owner to decide.

- **The owner has not yet confirmed the Seasons window's plan defaults** (A721, sent as an FYI,
  2026-10-17): Decisions 2, 12, 13, 14, 15 and 17 of the
  [A721 plan](superpowers/plans/2026-10-17-a721-seasons-window.md), each in
  [Decisions and deliberate limits](backlog/service-periods.md#decisions-and-deliberate-limits).

- **A Save refused because a season the person binned was deleted elsewhere says nothing**: the
  window drops the bin's note and the delete, and Save offers the rest of the draft again with no
  message (`save`, `seasons-window.ts`). Whether it should say so is the owner's call. Left open by A721.

- **The Seasons window names each row's fields by their field label alone** — "Name", "Day", "Month"
  and "Colour", the last three followed by the chosen value — never by the row's season. Consider
  naming each by its row ("Day: Winter"), as `variant-table.ts` names a row's buttons
  ("Edit: {variant}"). Left open by A721.

- **Seasons on a venue that ran before A721 read grey until recoloured**, the owner's box
  included unless it is reset: the migration gives every existing season `grey` (`0058_dusty_iron_fist.sql`,
  `packages/venue-service/drizzle/`). Recolour them in the Seasons window, or reset the venue.
  Left open by A721.

- **A season reads two shades of its colour**: the Seasons window's colour chooser paints the solid
  palette colour (Winter `rgb(47, 85, 212)`), while the season chips, the Year's days and a viewer's
  swatches paint the paler station tint (`rgb(220, 230, 251)`); a period shows one solid colour
  everywhere. It follows from A721's Decision 10 (seasons take the station tints) meeting the shared
  `wt-colour-chooser`. Owner's call: keep, or have the chooser show the tint for seasons. Measured in
  A721's LOOK, 2026-10-18 (#1843). Left open by A721.

- **At phone width the Seasons window cuts longer colour names** ("Oran…", "Turq…"; at 390 px on
  2026-10-18, Magenta and Orange in English, and Magenta, Amarillo, Naranja and Celeste in Spanish): while the table is
  narrower than 480 px, each row's colour button is capped at 120 px so the start date stays clear of the pinned bin column
  (`seasons-window.ts`, #1843). 1280 px is unchanged. Owner's call whether the cut is acceptable or the
  row should stack on a phone. Left open by A721.

- **At 390 px the Seasons window's month picker runs off the right edge.** Seen on the demo venue
  on 2026-10-18 by A783's look: each row's month select, and the required star on "Starts on", fall
  past the right edge (`seasons-window-{light,dark}-390[-es].png` in
  `~/waitron-campaign-b/a783-shots/`; `packages/venue-service/src/dashboard/seasons-window.ts`).
  Left open by A783.

- **The Periods window: two looks from A719's LOOK (#1838).** At 390 px a period's swatch beside a
  name that wraps shrinks to 14.4 px wide (the others are 16 px); at 1280 px the window is full
  height with about 300 px blank above Close, because it is the unsized `wt-modal`. Both measured
  on the demo venue (`~/waitron-campaign/a719-look-report.md`, C2 and C4). Left open by A719.

- **The special-day painter does not say a deleted period's replacement is still missing after a
  failed re-read.** When a period is deleted in the Periods window over the painter and the
  painter's re-read of the day fails, nothing tells the manager until Save shows "could not save"
  (finish-branch's account of its own fix on #1838; not re-run since). Left open by A719.

- **A per-field department policy repair changes the trading-name default.** With no policy row,
  readers show the trading name off; PATCH of `orderStart` inserts a row with it on. A real route
  probe at base `c704ac0dc` returned `{before:false, after:true}`. Left open by A493's review;
  align `setDepartmentSalePolicyField` repair defaults with the existing readers, with a failing
  authenticated route case first. The combined department editor preserves the off fallback.

- **A855. The till's zones read builds date formatters on every call (2026-10-18).** About 0.75 ms
  of each `GET /api/zones` goes on `new Intl.DateTimeFormat`. Next: keep one formatter per time
  zone. Left open by A504.
  [Detail](backlog/service-periods.md#a855-the-tills-zones-read-builds-date-formatters-on-every-call)


_Formerly entries spread across the old sections, A261's venue-operations steps among them; part of A9._ Detail: [backlog/service-periods.md](backlog/service-periods.md).

- **The Month's year link: its focus ring nearly touches the month's name.** The ring sits in the
  space before the year ("September[2026]"), readable but tight (A759's look, #1812). A margin on
  the link must also go on the hidden width copies in `fixed-title.ts`, or the arrows move again.
  Left open by A759.

- **Loose ends left by A755 (#1809).**
  - The Venue card says nothing about a time zone locked by a past business-day change. The server
    gives the reason `business_day_history` (`apps/server/src/venue-details.ts`); `REASONS` in
    `apps/dashboard/src/screens/venue-details-panel.ts` has no sentence for it.
  - A824. Show Venue settings' Defaults card read-only to supervisors (owner, 2026-10-17). As
    built, only a session holding `venue.configure` sees it (the `defaults` entry of
    `CORE_SETTINGS_PANELS`, `apps/dashboard/src/dashboard-app.ts`), and the server's
    `GET /management-api/venue-defaults` (`apps/server/src/location-settings-api.ts`) also needs
    `venue.configure`; a supervisor, who holds `venue.view` alone, sees the other three cards
    read-only and no Defaults card. Done when a server test reads
    `GET /management-api/venue-defaults` with `venue.view` alone and is answered, a test finds the
    `PUT` still refused, and a dashboard test signed in with `venue.view` alone finds the Defaults
    card's values shown and nothing editable.

  [Mockups](backlog/mockups/a755-venue-settings/)

- **Loose ends left by A788 (the business-day start changes at the next changeover).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a788)
  - A862. Two Calendar reads draw a past day's range uncut where the Calendar cuts it: the
    special-day painter's season days (`readSeasonDays`,
    `packages/venue-service/src/opening-hours-calendar.ts`, passes no cut) and the named days'
    closed flag (`packages/venue-service/src/named-days.ts`).
  - A863. A clash sentence names a range by its period, zone or department and its times only
    (`clockChangeConflictText`, `packages/venue-service/src/dashboard/clock-change-conflict.ts`), so
    a range in another department or on another weekday reads as if it were the one being edited.
  - A864. The Business-day start dialog's clash list can run to dozens of lines with no "and N
    more": the server caps the list at 20 ranges but lists each once per season it is painted in.
  - A865. The clash list's order between departments, and between one special day's dates, is not
    fixed (reported by A788's implementers, not reproduced since).
  - A866. A keep-open saved for tonight by a deactivated department still blocks a start change
    (`keptOpenConflicts`, `packages/venue-service/src/business-day-schedule.ts`, reads every
    department).
  - A867. A day where one range crosses the new start and two others overlap lists only the
    crossing one; the overlap appears only on the next Save. No test pins either half.
  - A868. Renaming a special day is refused while any stored range clashes with a waiting start,
    though renaming a period or a season is not (`saveSpecialDay`,
    `packages/venue-service/src/special-days.ts`).
  - A869. While a start change waits, a one-off special day dated after it, with hours that fit
    the start it will have, is refused `special_day.invalid`: one-off dates are read under the
    starts already in force.
  - A870. A past one-off special day is checked for last orders over an empty day on a venue that
    holds any start change, but over its season's ranges on a venue that holds none.
  - A871. Branches no test pins in A788's hours writers: an unchanged week resubmitted beside a
    stored clash (`menu-timetable.ts`), a season delete while a change waits (`seasons.ts`), and an
    all-day range or two waiting changes in the menu-week check.
  - A872. A preview or a Save works out the next-changeover plan at least twice
    (`planBusinessDayStart`, then again in `clockTransitionAt`).
  - A873. A refused Save's message in the Business-day start dialog stops "The business-day clock
    changed. Close and reopen to review it." from appearing when the clock then changes
    (`business-day-start-editor.ts`, the guard in `willUpdate`).
  - A874. The Business day card re-reads at a waiting change's moment by the browser's clock, and
    once more if that answer still shows the change waiting; a server clock still behind at the
    second answer leaves the New start row up until the next refresh.
  - A876. On a day a start change makes longer than 24 hours, a season range past the 24th hour
    is cut at it only when a special day is painted on that date (`cutSeason`,
    `packages/venue-service/src/day-resolver.ts`).
  - A877. Five places work out which start changes have taken effect and which still wait, and
    each hours writer runs the waiting-start check by hand.

- **Eleven `receipts.*` strings in `apps/dashboard/src/i18n/strings.ts` have no reader** — found
  while doing A755 (#1809); none had one before it either: `departments_zones`,
  `language_copies`, `language_receipts`, `language_save_error`, `not_printed`, `preview_for`,
  `preview_paper`, `trading_name_location`, `trim_save_error`, `venue_defaults` and `venue_wide`.

- **Loose ends left by A720.**
  - Look at a picked, focused today in the Month. `--wt-focus-offset` and
    `--wt-field-line-width-active` are both 2px (`packages/ui-core/src/tokens/structure.css`), so
    on today, picked and focused, the focus ring covers the outer half of the wider picked ring
    (`opening-hours-month.ts`). A720 Part 4's LOOK shot focus only on other days; check in both
    themes that this combination reads well.
  - The day box should re-place itself when its content changes. `calendar-day-box` measures its
    content only in `show()` and on a scroll or resize, so each host (Opening hours'
    `placeDayBox`, Staffing's month) must wait for every pending redraw first; A720 Part 5's first
    version placed it one redraw early, off screen. Have the box re-place itself while open
    whenever its own content changes.
  - An ignored `to` stays in the address bar. A special-day address whose `to` is earlier than its
    date, malformed, or more than 365 days after it opens the new day on its first date alone
    (`HOURS_RANGE_MAX_DAYS`, `opening-hours-screen.ts`), but the address still shows the `to`.
  - Try the Calendar's long press on a real phone. The long press that opens the special-day
    editor, and the long press then drag that picks a run (`day-picking.ts`), were checked only
    under headless Chromium's touch emulation. Check on an Android and an iOS phone that the page
    stops scrolling, no number is selected, and no click or menu follows the lift.
  - Move the pointer-gesture commands' type declarations into `packages/ui`. They live in
    `packages/venue-service/src/dashboard/pointer-gestures.d.ts`, beside their one user; the commands
    themselves are in `packages/ui/src/vitest-pointer-gestures.ts`. Move them when a second package
    uses the commands.

- **A server write that changes a department's hours leaves its zones' closures outside them** —
  left open by A723 (#1849); the next save of such a zone is refused. [Detail](backlog/service-periods.md#a-server-write-that-changes-a-departments-hours-leaves-its-zones-closures-outside-them)

- **The zone-closure hours check runs at the routes, not inside the writers** — left open by A723 (#1849);
  a direct caller of the writers is not checked. [Detail](backlog/service-periods.md#the-zone-closure-hours-check-runs-at-the-routes-not-inside-the-writers)

- **Unticking a special date's "Closed all day" brings back its zone paint unchecked** — left open
  by A723 (#1849). [Detail](backlog/service-periods.md#unticking-a-special-dates-closed-all-day-brings-back-its-zone-paint-unchecked)

- **A change to a department's season week can leave a special date's zone closure outside its
  new hours** — left open by A723 (#1849); nothing checks it. [Detail](backlog/service-periods.md#a-change-to-a-departments-season-week-can-leave-a-special-dates-zone-closure-outside-its-new-hours)

- **A yearly special day's zone paint is checked against its stored date only** — left open by
  A723 (#1849), not against each later year's weekday and season. [Detail](backlog/service-periods.md#a-yearly-special-days-zone-paint-is-checked-against-its-stored-date-only)

- **`opening.follow_week` and `menu.normal_week` have no reader** — found during A723 (#1849); it
  predates A723. Both strings, English and Spanish, are in
  `packages/venue-service/src/dashboard/strings.ts` and nothing reads them; delete them or use them.

- **A special day whose dates have different changeovers is cut on the first date's changeover** —
  left open by A723 (#1849); the server checks each date on its own and can refuse. [Detail](backlog/service-periods.md#a-special-day-whose-dates-have-different-changeovers-is-cut-on-the-first-dates-changeover)

- **The season-week and closed-week routes do not lower-case a zone or season id, as the
  special-day route does** — found during A723 (#1849); it predates A723. [Detail](backlog/service-periods.md#the-season-week-and-closed-week-routes-do-not-lower-case-a-zone-or-season-id-as-the-special-day-route-does)

- **A cut-away zone stroke hides another day's refusal marker until the next Save** — left open by
  A723 (#1849). [Detail](backlog/service-periods.md#a-cut-away-zone-stroke-hides-another-days-refusal-marker-until-the-next-save)

- **A season closure on a special date is not cut or checked against that date's shorter hours** —
  found during A723 (#1849), by reading. [Detail](backlog/service-periods.md#a-season-closure-on-a-special-date-is-not-cut-or-checked-against-that-dates-shorter-hours)

- **A723's plan defaults sent to the owner as an FYI** (Decisions 1, 3, 6 and 7; A762's Decision 3,
  #1850, superseded Decision 9) — the owner may overrule any.
  [Detail](backlog/service-periods.md#a723s-plan-defaults-sent-to-the-owner-as-an-fyi)

- **A762's plan defaults sent to the owner as an FYI** (Decisions 1, 2, 3, 8 and 10) — left open by
  A762, #1850; the owner may overrule any.
  [Detail](backlog/service-periods.md#a762s-plan-defaults-sent-to-the-owner-as-an-fyi)

- **A purple season looks like a special day** — left open by A762, #1850. A purple season's band and
  Staffing-month line are 1.26:1 (light) and 1.63:1 (dark) from the special-day purple.
  [Detail](backlog/service-periods.md#a-purple-season-looks-like-a-special-day)

- **The Opening hours Month marks a special day only by its name** — left open by A762, #1850 (its plan's
  Decision 11): the Staffing month draws a purple run over a special day's dates, the Opening hours
  Month does not. The owner's "even on the month view the special day is not shown" may mean it too.

- **Special days have no colour of their own** — left open by A762, #1850 (its plan's Decision 2): every
  special day is the Calendar's special-day purple; a colour per day needs a column and a chooser.

- **Which name a record sent across a legal-name change carries** (A494 follow-up, 2026-10-11). A
  record keeps the name it was written with, so one written before the change but sent after it
  carries the old name, and a later cancellation of an earlier invoice carries the new one. Waits
  on the asesor's answer to Q37(d), S18 in `docs/compliance/asesor-questions.md`.

- **No test gives a second department its own paint on the same special day** — left open by
  A506-1, #1577.

- **Loose ends left by A506-3 (#1591).**
  - The Business day start dialog repeats the server's conflict-counting rule (`#conflictLines`,
    `business-day-start-editor.ts`), so a server change would make it miscount unnoticed.
    [Detail](backlog/service-periods.md#the-business-day-start-dialog-repeats-the-servers-conflict-counting-rule)

- **Loose ends left by A506-4 (#1597).**
  - A special-day line in the Business day start dialog shows its date unformatted ("2026-11-03").
  - `assertOwnPeriods` names a refused slot by its sorted position, not its position in the request
    (`packages/venue-service/src/menu-timetable.ts`; read in the code, not run).
  - The clock-skip check runs before touching ranges are joined: two halves of one period meeting
    at a skipped 02:30 are refused, while the joined range is accepted.
  - The special-day-then-season rule is written out in several places, and special-day paint is
    read by four separately written queries; each could collapse to one place.
    [Detail](backlog/service-periods.md#the-special-day-then-season-rule-is-written-out-in-several-places)
  - `business-day-schedule.ts` copies the changeover lookup of
    `packages/shared/src/business-day-clock.ts` (`oldCutoverOn`) to avoid validating the clock on
    every day; a lookup exported from `shared` that validates once would remove the copy.

- **A department or zone delete's preview never counts a special day's painted hours**, yet the
  delete removes them — left open by A506-5, #1603.
  [Detail](backlog/service-periods.md#a-department-or-zone-deletes-preview-never-counts-a-special-days-painted-hours)

- **Loose ends left by A577 (#1702).**
  - The Opening hours Year page does not show the warning that two special days share a date; only
    the Departments screen's readiness list does.
  - Between two special-day dates that both stand on their own terms, the earlier STORED date
    wins: a yearly "Feria" saved on 26 March 2026 beats a one-off "Cena de empresa" on 26 March
    2027, though a person may expect the one-off to win (`standingInYear`,
    `packages/venue-service/src/repeat-rules.ts`). Saving refuses such a pair, so it arises only
    from rows written another way.

- **The readiness line for a repeating holiday date names the official holiday**, not the special
  day's own name, and the Year's missing-holiday warning does the same — left open by A506-5,
  #1603. [Detail](backlog/service-periods.md#the-readiness-line-for-a-repeating-holiday-date-names-the-official-holiday)

- **Once a stored holiday date's year has passed, each order's service-state read
  (`readServiceDayPlan`) also reads the tenant, location and holiday area** to find that year's
  holiday: about 100 µs of roughly 860 µs per call, measured over 2000 calls on a Madrid test venue.
  A cache that outlives the transaction is one way to remove it — left open by A506-5, #1603.

- **The "Add to" offer reads every special day with every date** (`GET …/special-days`) to show a
  name and a latest date — left open by A506-5, #1603.

- **A789 — last orders without an offset: a period is when its menu can be ordered** — DESIGNED
  2026-10-18, waiting for the owner's answer to one question (Q39 in lane C's questions file;
  [design](superpowers/specs/2026-10-18-a789-last-orders-design.md), pictures in
  [mockups/a789-last-orders/](backlog/mockups/a789-last-orders/)); not built. The period end offset
  and the period "Keep open" go (the zone one stays); a dish taken during a period and sent after it
  ends opens a window asking the waiter to check with the kitchen, and once confirmed it is sent and
  marked on the kitchen ticket. Four slices; the till slice waits for lane G's A773-1, whose design
  says a period-ended line is never sent.

- **A painter opened from a Painted in chip in the Periods window does not return to the window
  when it closes**, so a manager loses their place — left open by A506-11, #1694.

- **The Opening hours model's `periods[].weekdays` and `routingUses` have no reader left in the
  dashboard**, while `readOpeningHoursModel` still works both out on every read. See also "Routing
  reads do work only one screen uses" — left open by A506-11, #1694.

- **The period delete dialog can keep Delete greyed out** after a refusal for a changed business-day
  start, when the Periods window's list is taken out of the document during its re-read and comes back
  (`period-delete-dialog.ts`; found by reading, not tried) — left open by A506-11, #1694.

- **The period delete dialog can skip a re-read and show slightly old counts** in a rare order of
  updates; the server still refuses a delete sent with an old clock revision — left open by
  A506-11, #1694.

- **A special day whose dates start their business day at different times is painted on one grid
  drawn from the first date's changeover**, with a notice saying so (`cutover`,
  `special-day-painter.ts`) — left open by A506-9, #1651.

- **`GET …/named-days` (`readSpecialDaysModel`, `named-days.ts`) has no dashboard caller**; server
  suites still pin it. Remove it, or keep it with a stated reason — left open by A506-9, #1651.

- **`range-dialog.ts` (`<range-dialog>`) has no caller**; only its own tests load it — left open by
  A506-9, #1651.

- **The end-offset check accepts a cutoff past the changeover** (a 06:00 cutoff past a 05:00
  changeover was saved). Decide whether to refuse it — left open by A506-9, #1651. A789's design
  removes the end offset; if the owner approves it, this entry goes with A789's slice 1.
  [Detail](backlog/service-periods.md#the-end-offset-check-accepts-a-cutoff-past-the-changeover)

- **A date another manager removed stays in the special-day draft** when this draft changed its
  paint or Closed tick — left open by A506-9, #1651.
  [Detail](backlog/service-periods.md#a-date-another-manager-removed-stays-in-the-special-day-draft)

- **A special-day draft whose only edits were dropped keeps its old clock revision**
  (`willUpdate`, then `dropUnpaintable`, `special-day-painter.ts`), so a new public-holiday day
  could be refused with `hours.clock_changed`. Found by reading, not run — left open by A506-9,
  #1651.

- **A live update that arrives during a special day's save that is then refused may never be
  taken in** (`save`, `special-day-painter.ts`), so a retry could send an old copy of a date; A637
  closed the same gap in the season painter. Found by reading, not run — left open by A506-9, #1651.

- **The Week's title and ruler scroll away with the days**; whether to pin them is open — left open
  by A722 Part 1, #1823.

- **Calendar Month and Week repeat the station loading, "Always open" and ready cases.**
  A725 retired the separate Times tab and its watcher; a shared drawing of the Calendar's
  station states remains a possible cleanup (`opening-hours-month.ts`, `opening-hours-week.ts`).

- **A failed re-read of the prep-station list keeps the stations already shown** in the
  Calendar's Show picker; only a list that never loaded leaves Show with departments only. Kept
  so a brief network drop does not lose a manager's chosen station — left open by A722 Part 3's
  Codex review, #1834.

- **Opening the Year from a station's Week may keep `/station/<id>` in the address**, though the
  Year shows no station. Found by reading, not run — left open by A722 Part 3, #1834.

- **Cosmetic points from A722 Part 3's look, #1834:** the Spanish phone Month breaks "Sin
  pedidos" mid-word (`.no-orders` in `opening-hours-month.ts` still allows a break anywhere; a
  day's name breaks only between its words since A784); at 320 px a 45-letter station name scrolls
  Show's open list sideways (the page does not widen); a station's Month has no key naming which
  bar is which department (hover shows it; the All departments Month has none either).

- **The painter cannot resize a block by dragging its edge**; painting over a block lengthens it
  and painting Closed shortens it — left open by A506-8, #1634.

- **Painting stops short of an off-quarter-hour changeover** (05:45–06:00 cannot be painted on a
  05:50 changeover) — left open by A506-8, #1634.
  [Detail](backlog/service-periods.md#painting-stops-short-of-an-off-quarter-hour-changeover)

- **A season painter save writes each edited week whole**, so it can put back days another
  manager changed, and nothing shows it — left open by A506-8, #1634.
  [Detail](backlog/service-periods.md#a-season-painter-save-writes-each-edited-week-whole)

- **`ModelWatches.reread` (`model-watch.ts`) holds back reads that started before a save only for
  its own client's watches**; another `OpeningHoursApi` on the same live data still applies them.
  Read in the code, not run — left open by A506-8, #1634.

- **`PUT …/departments/:departmentId/menu-week` and `PUT …/zones/:zoneId/closed-week` (`routes.ts`)
  are called by no client** now that the painter saves through `PUT …/seasons/:seasonId/weeks`.
  Remove them, or keep them with a stated reason — left open by A506-8, #1634.

- **Without a navigation guard, which only test harnesses lack, the painter's history mark is
  copied to later entries**, so ✕ can go back to a later entry of the same screen — left open by
  A506-8, #1634.

- **The navigation guard's `write()` and `rewrite()` refuse while a leave question is open**, so a
  live refresh that moves the painter to another season then leaves the address on the old season
  — left open by A506-8, #1634.

- **At 390 px a block too short for both lines shows its period's name but not its times**; only
  its spoken label names them (`paint-grid.ts`) — left open by A506-8, #1634.

- **Public holidays' names show in Spanish in the English interface**: the official lists carry
  one name per holiday. Believed to predate A506-7; not checked against the year view's history —
  left open by A506-7, #1623.

- **On a phone, a holiday name cut with "…" on a date that also has a special day cannot be read
  whole**: the tooltip needs a pointer, and the day box shows only the special day's name
  (`openingHoursDay`, `opening-hours-day.ts`) — left open by A784.

- **The special-day painter's note under "Every year" (`special.holiday_note`) says "each year"
  twice in English** and reads as awkwardly in Spanish — left open by A506-7, #1623.

- **Two date helpers read years 0 to 99 as 1900 to 1999** (`isLocalDate`, `addMonths`); changing
  `isLocalDate` changes which dates the server accepts, so it needs a decision — left open by
  A506-6, #1609. [Detail](backlog/service-periods.md#two-date-helpers-read-years-0-to-99-as-1900-to-1999)

- **Two holidays with one name in one year's list** (retro review of #1603). The holiday dates a
  save reads keep only each name's first date in the year (`readHolidayDates`,
  `packages/venue-service/src/holidays.ts`). No shipped list has one. Re-check when a new year's
  list is added.
  [Detail](backlog/service-periods.md#two-holidays-with-one-name-in-one-years-list)

- **Re-check that each Departments screen recovery case fails when its recovery step is deleted.**
  An unresolved assertion finding from A366 slice 6 Part C (#1510); A493 relocated its owner.

- **A825. Check the six Departments and menus (#297) leftovers against today's code, then trim
  (owner, 2026-10-17).** The leftovers: remove the legacy price and fixed-station compatibility
  fields; per-menu modifier authoring; workforce assignments; immutable department attribution and
  reporting; batched readiness and offer queries; a replication smoke test. Drop each one today's
  code has overtaken, keep any real gap as its own short entry in this area, then delete this one.
  Same legal seller is the working assumption, to confirm before go-live. Hours moved to A254.

- **Refresh service settings on an open till** — decide how changed department/zone policy
  reaches an empty till and preserves an existing basket's facts, then carry it through polling.
  Fresh sign-in reads changed settings; the open till keeps its loaded flow.
  [Detail](backlog/service-periods.md#refresh-service-settings-on-an-open-till)

- **Service-policy import completeness** — run a real import with department or zone policy
  rows omitted. If it commits, reject or repair that incomplete shape before service begins.
  The review's import probes stopped before these tables; reachability remains unverified.

- **Concurrent department settings edits** — decide whether two managers editing the same
  department need stale-write protection. The form sends its whole draft; a runtime overlap
  probe remains to be run before choosing a conflict policy.

- **Split an order's recorded service mode into two facts (owner, 2026-10-09) — future work.**
  Served at a table or counter; payment due before the kitchen, at collection or at the end of
  the tab. Slice 6 keeps the three-value order record and its behaviour.
  [Detail](backlog/service-periods.md#split-an-orders-recorded-service-mode-into-two-facts)

- **Compare computed station weeks with live routing on a painted special-day date without zone paint.**
  The slice 4 review read the planning and zone-week paths but did not compare the real sale
  resolver. Add a real-database comparison before claiming they agree on that case.

- **Sending grace after a period extension is replaced or expires** — decide whether a positive
  end offset survives a later period's extension or the business-day changeover; two real-store
  probes observed it ending with the replaced/expired row. The current one-row/today-only rule is
  approved slice 3 decision 4. A789's design removes both the offset and the period extension; if
  the owner approves it, this entry goes with A789's slices 1–2. [Detail](backlog/service-periods.md#sending-grace-when-a-period-extension-is-replaced-or-expires)

- **Who authorised today's station or period change** — A366 slice 3 decision 14 leaves
  the authorising person's identity unstored. Decide whether to retain that identity before
  adding a history view. [Detail](backlog/service-periods.md#who-authorised-todays-station-or-period-change)

- **Departments, service styles and opening hours (A254, owner 2026-10-03) — residuals.**
  Tabs without tables, the remaining department-name survey, and advisor questions stay open.
  [Spec](superpowers/specs/2026-10-03-departments-service-styles-hours-design.md);
  [Detail](backlog/service-periods.md#departments-service-styles-and-opening-hours-a254-owner-2026-10-03--draft-spec-partly-implemented-through-a261)

- **A rename refusal without a supplied name remains a database error, rather than returning an
  undefined name** — left open by A261-2d (#1274).

- **Smaller notes from the Hours reviews** — left open by the reviews of A261 step 5 (Hours, #1298):
  repeated-midnight clock choices still need checking.
  [Detail](backlog/service-periods.md#smaller-notes-from-the-hours-reviews)

- **2027 data** — left open by A261 step 6 (Public holidays, #1305). Not shipped; the BOE daily
  summaries to 2026-10-06 held no 2027 national list. Follow the yearly update once it is published
  ([public-holidays.md](developers/public-holidays.md)). Andalucía's own 2027 calendar (BOJA,
  Decreto 84/2026) is not national coverage and is not shipped.

- **Canary islands** — left open by A261 step 6 (Public holidays, #1305). The island choice is built
  from the data, but setup refuses the Canary provinces, so no venue reaches it.

- **Smaller notes from the public holidays reviews** — left open by A261 step 6 (Public holidays,
  #1305): there is no control to clear a chosen area back to "not chosen" (the route accepts it);
  the area names "Arán" and "Lleida, fuera del territorio de Arán" are Spanish data labels shown
  untranslated in English; …
  [Detail](backlog/service-periods.md#smaller-notes-from-the-public-holidays-reviews)

### The kitchen and preparation

_Formerly the kitchen entries in the opening part of the old Track A (before A1), and kitchen entries elsewhere; part of A9._ Detail: [backlog/kitchen.md](backlog/kitchen.md).

- **A756. The Kitchen tab split up (owner, 2026-10-16; changed by A773 the same day).** Left: the
  parts that wait for A773-1 — the reminder to send the next course on the department's Service
  tab, and late flags, identical dishes, held courses, MOVED slips, done on the screen and changes
  after sending on each station — then the Kitchen tab's removal, after A773-2 takes fire control
  away (plan `docs/superpowers/plans/2026-10-18-a756-kitchen-tab-split.md`, "Parts that wait").
  Open points from #1852 and #1854 are in the detail. [Detail](backlog/kitchen.md#a756-the-kitchen-tab-split-up-a-courses-page-a-department-service-tab-and-an-every-station-card), [mockups](backlog/mockups/a756-kitchen-settings/)

- **A807. One slip per printer and one notice per station for a whole-order kitchen-note change
  (owner, 2026-10-17).** Today a change or removal of the order's kitchen note prints one slip and
  raises one acknowledged notice for each affected dish (A743's default). Print one slip per printer
  listing the affected dishes, and raise ONE notice the cook acknowledges once per station. Done
  when `apps/server/src/order-kitchen-note.corrections.test.ts`'s three-dish edit shows one slip per
  printer and one notice per station.

- **Supervisors have no dashboard path to a prep station's times** (ASK A1 of A506-12). The times
  show in the Calendar's Show picker, offered only to someone with `venue_service.manage`: a
  read-only Calendar offers no stations. The stations service-times route still lets `venue.view` read them (`routes.ts`). Owner to decide whether a
  supervisor gets a read-only view, which would now mean offering stations in a read-only
  Calendar's Show — left open by A506-12.

- **Browser tests still read `history.length` to tell whether a push happened, and Chromium stops
  it at 50**, so past that a test cannot see a push (`git grep -l 'history\.length;' -- '*.test.ts'`,
  Prep stations' older address cases among them). Move them to `pushState`/`replaceState` spies, as
  the retired-address tests do — left open by A506-12.

- **A routing period line naming another location's period is flagged but never drawn** (left open
  by A455, #1492): the server marks it `notOffered`, but the grid (`routing-grid-model.ts`) and the
  cell editor (`routing-cell-editor.ts`) drop a line whose period is not in the model's periods, so
  an unrelated save of that cell removes it silently. Reachable only by a hand-made database insert.
  Fix: show the line and make removing it an explicit choice.

- KDS-4 follow-up: device-mode reprint behind `requireDevice`.

- **A808. A reprinted kitchen ticket shows when it was reprinted (owner, 2026-10-17).** The heading
  reads `*** REPRINT HH:MM ***`, the local time of the reprint, where today it reads
  `*** REPRINT ***` (`apps/server/src/kitchen-ticket.ts`); the original send time stays on the
  ticket. Done when a ticket test pins both times on one reprint.

- **KDS operations — low priority (A9)** — Gaps: a routing audit view (a routing cell keeps no
  record of who changed it or when — the most useful to close); no station `type`/`kind`;
  single-target only. [Detail](backlog/kitchen.md#kds-operations--low-priority-a9)

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group; printing
  problems).** [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)
  - A party finished while its food is still on the pass keeps its cards there with no group
    button that works (each is refused `party.not_open`). Designed in A758 §3.8 (revised
    2026-10-18 for the owner's Q40 answer): Finish table asks first, cancelling with a reason and a
    Refund tick per dish; the paid receipt's Cancel items… opens the same dialog; the card says
    Table finished. Waits for the owner's Q43 and for A773-1.
  - `*** REPRINT ***`, `GROUP n`, `*** HOLD ***`, `*** FIRE ***`, `*** HOLD CHANGED ***` and
    `*** HOLD CANCELLED ***` print in English.
  - A switched-off printer's printing problem keeps showing until the printer is switched on and a
    Reprint prints there; there is no way to dismiss one.
  - A failed ticket on a pass printer (one ticket for the whole order) shows on the card of every
    station it covered, even where that station's own printer printed; it stops showing at a
    station once a Reprint of the bill would not link that pass printer to that station.
    _2026-10-10 (A366 slice 5 Part B): a pass printer is now a printer listed on every station,
    and its combined ticket is linked to each, so this applies again._
  - Finish table drops the problem of a bill that transfers emptied (read, not run; not re-checked
    by B6a).
  - After a merge, a reprint of the absorbed bill that was still waiting at the merge clears
    nothing when it prints, so its warning stays until the merged bill is reprinted once more
    (`moveKitchenPrintLinks`, `apps/server/src/kitchen-print.ts`).
  - Only dishes whose unit does not print on the ticket — sold in Each by the unit's identity
    (`readLinesSoldInEach`), or with no unit recorded on the line — are added together or split; a
    venue-made unit that counts pieces (a "portion"), even one spelled like Each, prints line by
    line, because nothing records a unit's kind (a unit field would need a migration).
  - The kitchen-ticket grouping setting sits on Venue settings' **Kitchen** tab, and so does "Print
    held groups in advance", which is not about sent work at all.
  - `fireHeldGroupsOfCourse` (`apps/server/src/order-groups.ts`), through which a course Fire still
    fires a party's held groups, is to be removed in a follow-up.
  - Setting up a venue from an imported configuration deletes every kitchen station, and the
    `kitchen_print_jobs` station key has no delete rule; whether that venue can already hold link
    rows at that point was not tested (read, not run).
  - The pass's Ready and Away record no `order_group_events` row, so who pressed them is recorded
    nowhere readable; a new kind changes that append-only table's check, which is a core migration.

- **A809. The table screen reads its printing problems in the groups read (owner, 2026-10-17).**
  Today every table load makes a second request, `GET /api/parties/:id/print-problems`, beside
  `GET /api/parties/:id/groups` (`apps/server/src/till-api.ts`). Fold the printing problems into the
  groups read and drop the second request; the exact-body assertion in
  `apps/server/src/till-api.groups.test.ts` changes with it. Done when a table load no longer
  calls `GET /api/parties/:id/print-problems` and the printing problems arrive in the groups read.
  Which held groups the kitchen and pass screens offer Fire on is A773's.

- **Loose ends left by service Task 6 (#761, HOLD tickets in advance).**
  [Detail](backlog/kitchen.md#task-6-761-hold-tickets-in-advance)
  - A failed HOLD correction slip (HOLD CHANGED or HOLD CANCELLED) raises no "Printing problem",
    like every correction slip: none is recorded in `kitchen_print_jobs`.
  - A printed HOLD ticket goes stale when held groups are reordered or a party is merged into
    another (both renumber `GROUP n`). Only a FIRE ticket or a Reprint can be relied on.
  - Whether a group's HOLD ticket was queued is recorded per group, not per station, so a
    correction, and a Reprint's REPRINT and HOLD section, can print at a station whose printer
    never printed that group's HOLD ticket.

- Left by C78's review: the earliest fire time is picked by comparing the stored times as text,
  right only while every writer stores the same `toISOString()` form (every writer found uses
  `nowIso()`; not proven for all); and a dish recalled and fired again carries its new fire time but
  its old group's firer. Left open by the table actions plan's Task 9 (#874, dishes arriving in a
  party get a kitchen group).

- **C80: a dish whose course is switched off is a dish with no course (owner, 2026-10-17)** — Fire
  now, listed first, whether sent or moved; relayed to A773. Delete this entry once A773 covers it.
  [Detail](backlog/kitchen.md#left-by-c80-a-dish-whose-course-the-till-does-not-list)

- **`GET /management-api/stations/outputs-down` and the dashboard's `listOutputsDown` have no
  caller** — found while removing the Stations tab's health read (A366 slice 4 decision 34): the
  route (`apps/server/src/management-api.ts`) and the client method
  (`packages/venue-service/src/dashboard/routing-client.ts`) are called only by their own tests.
  Decide whether to remove them or use them; slice 4 Part A leaves both.

- **A long word in a routing-grid row name still splits at 390 px** — a word wider than what is
  left of the capped first column beside the indent and the arrow still breaks inside itself
  ("BOCAD/ILLOS", "CLAN/DESTI/NA" one level down). Options: widen the cap, shrink the arrow at
  phone width, or hyphenate.
  [Detail](backlog/kitchen.md#a-long-word-in-a-routing-grid-row-name-still-splits-at-390-px)

- **The station editor's Printers read-out (no `printer.manage`) is reachable only at component
  level** — module screens are not told the person's permissions, so Prep stations always passes
  `canManagePrinters` (`packages/venue-service/src/dashboard/prep-stations-screen.ts`). Left open
  by A366 slice 4 Part A.

- **A pass printer must be added to each new station by hand.** A pass printer is now a printer
  listed on every station; a watcher set to follow every station used to cover a new station at
  once. Consider an "add to every station" control. Left open by A366 slice 5 Part B (decision P2).

- **The server accepts a routing period line naming the cell's own plain station**; it routes
  nothing differently (`validatePeriodLines`, `packages/venue-service/src/routing-store.ts`). Left
  open by A366 slice 4 Part A.

- **The Products folder note ("some items made elsewhere") counts a period line for a department
  no active zone serves** (`folderMadeAt`, `apps/dashboard/src/widgets/folder-made-at.ts`). Left
  open by A366 slice 4 Part A.

- **The period delete warning orders its rows on the server** (`routingRowPlaces`,
  `packages/venue-service/src/menu-timetable.ts`) **with a copy of the Routes tab's row order**
  (`visibleRoutingRows`); a change to one can leave the other behind. Move the order into
  `packages/venue-service/src/routing.ts` and use it from both. Left open by A366 slice 4 Part A.

- **Routing reads do work only one screen uses** — left open by A366 slice 4 Part A's review:
  every read of the routing model works out each period's products (`readRoutingPeriods`), which
  only the routing cell editor needs; and the Opening hours model reads every period's routing uses
  (`readRoutingUses`). Work each out only where it is used.
  [Detail](backlog/kitchen.md#routing-reads-do-work-only-one-screen-uses)

- **A selected tab that grows while its strip keeps its width is not scrolled back into view**
  (`packages/ui/src/components/wt-tabs.ts`) — left open by A487a (#1540): a late font load or a
  longer label can leave it cut at the strip's edge, and `main` before #1540 behaved the same. Since
  #1540 the fade is resized when the tab grows; scrolling it back was not added because doing so
  broke the "leaves a strip the reader scrolled where it is when only its height changes" case.

- **`PUT /management-api/stations/:sid/printers` (`apps/server/src/print-api.ts`) has no dashboard caller** since A366 slice 4 Part A
  moved a station's printers into the station save; `parseStationPrinterIds`
  (`apps/server/src/management-api.ts`) repeats its checks. Decide whether to remove the route.

- **A routing choice a refresh drops names one reason, chosen when it is dropped** — left open by
  A375 (#1382, its review, 2026-10-07): if its zone and its category both go and only the zone comes
  back, the message still names the zone; and only a returning zone or product has a test that the
  message clears — a returning category or No category row has none.

- **KDS corrections deferred from #191** — owner, 2026-09-01. A moved dish must keep its kitchen
  status — the ticket must travel with the line, not re-fire. Then the low-priority KDS list under
  [KDS operations](backlog/kitchen.md#kds-operations--low-priority-a9).
  [Detail](backlog/kitchen.md#kds-corrections-deferred-from-191)

- **Order-timing and modifier follow-ons**: delivery-order floor flash, idle-floor escalation,
  station-kind threshold defaults, an unbumped-since-fire metric; on-screen modifier `×N`, the shared
  `#allergens` render, the KDS-versus-till unreviewed-dish call, the TS-4 partial-transfer
  modifier-split guard.

- **Mark a new dish as urgent** — owner, 2026-09-27. A waiter can already send a new dish straight
  to the kitchen ("cook this now, don't hold it") under every release setting; the owner would like
  a way to add urgency to it too, so the kitchen sees it flagged. Nothing like it exists today.
  [Detail](backlog/kitchen.md#mark-a-new-dish-as-urgent)

- **Keep pass screen Done marks through a `ticket_items` rebuild — OPEN (3d).** — left open by the
  product folders work. `pass_item_marks` cascades from `ticket_items`, so a rebuild empties those
  marks.

- **Three follow-ups 3c-1 left:** — left open by the product folders work. the kitchen screen's
  column view has no per-order card, so it does not show the rest of the order…
  [Detail](backlog/kitchen.md#three-follow-ups-3c-1-left)

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

- **The review left detached `readOnly` changes and a retained table's scroll/sort unverified**; no
  defect was reproduced for either. Before changing screen caching, exercise those transitions. Left
  open by A331 batch 4d (preparation stations' Save state, #1426).

- **Kitchen cards: look points seen in A366 slice 5's look pass, and on its base `4f61b4ab9`
  too** — the overdue badge runs the card's full width; an empty status line leaves a double gap;
  a held dish shows its own Done, and cards grow tall; Spanish shows "1 atrasados", a plural
  after one; and at 390 px the cards are of uneven widths. Left open by A366 slice 5 Part A.

- **The till's own Station and Pass screens, left with nothing to show, say nothing** — a kitchen
  display shows a sentence saying what to do, but a till or handheld whose choice a profile
  narrowed to nothing shows an empty screen. Left open by A366 slice 5 Part A.

- **A move made from the old station's own screen still gives that station a "moved" notice, and a
  correction slip where its ticket printed** — `moveDishesToStation`
  (`apps/server/src/station-move.ts`) does so whoever moved it. Should it? A question for the owner.
  Left open by A439.

- **A694 — Correction slips do not print the party's name (2026-10-15; open, owner decision).**
  Kitchen tickets and MOVED slips read "Order 5 · Ana" for a named party (A683). The other kitchen
  slips — VOID, RECALLED, MOVED TO a station, HOLD CHANGED, HOLD CANCELLED and CHANGED (an extra
  taken off) — still print the bare order number (`formatCorrectionSlip`,
  `apps/server/src/kitchen-ticket.ts`). Decide: should they carry the name too? Left open by A683.

- **A695 — Naming or renaming a party after its food was sent prints nothing (2026-10-15; open,
  owner decision).** Since A683 a named party's kitchen tickets read "Order 5 · Ana", but Name the
  party prints no MOVED slip (A650 design, path 17), so a ticket already on the rail keeps the old
  name, or none, while later tickets for the same order carry the new one. Decide: should a rename
  of a party with sent food print a slip?
  [Detail](backlog/kitchen.md#a695--naming-or-renaming-a-party-after-its-food-was-sent-prints-nothing)

- **A692 — Editing a sent dish decides its extras' "made here" again, by the device that edits
  (2026-10-15; open, owner decision).** The dish keeps its earlier made-here choice
  (`keepMadeHere`, `apps/server/src/working-order.ts`), but its extras are routed afresh in
  `insertSplitExtras`, which reads the made-here stations of the sending device. Decide: should
  extras keep their earlier choice, as the dish does?
  [Detail](backlog/kitchen.md#a692--editing-a-sent-dish-decides-its-extras-made-here-again-by-the-device-that-edits)

### The till, devices and table service

- **A803. Bills and tables: one portion per order line, one bill switcher, one picker (owner,
  2026-10-18).** Owner-approved design, not built; follows A773-1, queued in lane G. Every order line holds one portion with its
  own extras ("2 ×" is display only); bills can be named and the name reaches kitchen tickets and
  the pass; the main bill and the Tab button go; every device shows one "Bill 1 of 3 ▾" switcher
  with Bill ⋯ and Table ⋯ menus; Move dishes… replaces Split by item and Transfer items; Split a
  table takes any mix of bills and dishes in one step, waiting courses included; one payment pays
  one bill; "Give back" becomes "Refund". The pre-bill part waits for the asesor (S2, A446).
  [Spec](superpowers/specs/2026-10-18-a803-bills-and-tables-design.md);
  [mockups](backlog/mockups/a803-bills-and-tables/).

- **A757. Table states: review the lifecycle, then retire the Tables tab (owner, 2026-10-16).**
  Design first. Decided: the Tables tab goes; optional states are switched per department; an
  optional state is one the code understands, not a label the venue makes up. A773 adds a Requested
  state (the waiter fired it; the pass has not yet); the held mark counts it. **Owner answered
  Q15–Q20 on 2026-10-17 and added a countdown to Time to fire, two pulse speeds, zone tabs that
  carry a hidden zone's most urgent state, service steps a venue defines, a "nothing needed" look
  and whole-table status on the map; the design is revised and Q29–Q34 answered A, A, A, A, A, A on
  2026-10-17.** Slice 1, Needs clearing per department, landed (plan
  `docs/superpowers/plans/2026-10-19-a757-1-clearing-per-department.md`); slices 2–8 are left
  (design §11).
  [Detail](backlog/till.md#a757-table-states-review-the-lifecycle-then-retire-the-tables-tab),
  [Design](superpowers/specs/2026-10-17-a757-table-states-design.md),
  [mockups](backlog/mockups/a757-table-states/)

- **A893. Owner review of every table state and its look, after A757 lands (owner, 2026-10-18).**
  Show the owner each state on the map and the card, both themes, with the pulses and zone tabs, and
  settle the two suggestions in the detail. Waits for the whole of A757 (slices 2–8 are left).
  [Detail](backlog/till.md#a893-owner-review-of-every-table-state-and-its-look-after-a757-lands)

- **A758. Voids and comps: the rules, then a page of their own (owner, 2026-10-16).** The owner
  answered all eight questions on 2026-10-17: two kinds of reason, Void and Comp (a 100% comp is
  the give-away, printed "Descuento 100%"); per reason, "Who can apply it" and "Who can approve it"
  as multi-selects over today's roles, built now (editable roles, A7, has not landed); every limit
  the venue's own, with an approver's PIN above it; the bill-wide limit a euro amount of comps with
  its own approver list; a Void switch "Ask for approval only once the kitchen has it", matched to
  A773-1's Cancel item choices; a seven-reason starter list. Then the page "Voids and comps" under
  Service, with search, drag handles and Delete. **Design revised 2026-10-17, and on 2026-10-18 for
  food left on the pass after a table has paid (§3.8), rewritten for the owner's Q40 answer: every
  cancel on a paid bill takes a Void reason (from the list, or "Other" with a typed note), with a
  Refund tick per dish — held or not started ticked, being prepared or ready not; unrefunded dishes
  stay on the bill and the invoice. The build waits for the owner's answer to Q43.**
  [Detail](backlog/till.md#a758-adjustment-reasons-review-the-rules-then-a-page-of-their-own),
  [Design](superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md),
  [mockups](backlog/mockups/a758-adjustment-reasons/)

- **Review follow-up: nutrition for extras in Current orders.** The A668-5 reviewer’s
  read-only finding is that Current orders’ extra summaries carry names and quantities, while the
  pending/served child rows can show their own nutrition icons. Reproduce the two views with a
  dish and a differently declared extra, then decide whether the Current orders wire and rows
  should carry the extra’s nutrition too. The visual difference is unverified; A668-5’s explicit
  dish-name scope does not decide it. See `apps/till/src/api/client.ts` (`CurrentOrderRow.extras`)
  and `apps/till/src/screens/till-table-order-screen.ts` (`#currentRow`).

- **A765. Say which table an order belongs to (owner, 2026-10-16).** Held orders shows a table's
  bill as "#2" with nothing else; the summary carries only a party id. The server sends the table's
  name and every order list shows it: Held, Waiting, Transfers, the Pass and the payment panel.
  [Detail](backlog/till.md#a765-say-which-table-an-order-belongs-to)

- **A785. A kitchen screen in device mode keeps its start-up settings until reload (left open by
  A768, 2026-10-17).** Its bump mode and fire control never refresh: the menu-state poll that
  carries the setup revision starts only when someone signs in, and a kitchen screen in device mode
  has nobody signed in. Its station queue read could name the revision, as `/api/menu-state` does.

- **A786. A seated table with no main bill reads its bills before its lines (left open by A768,
  2026-10-17).** The lines read needs the bill `billToOpen` picks, so opening such a table sends
  two requests one after the other. A768's after-change probe timed it at 241–266 ms, against
  113–120 ms for a second table in the same zone.

- **On a short phone the till's More menu is taller than the room it gets (found by A681's look,
  2026-10-17).** At 320×568, with the person's name moved into More, the menu's content (625 px)
  overflows the 552 px it is given, so Log out sits below the menu's bottom edge and nothing says
  the menu scrolls. The look hid A681's Theme row and Log out was still below the edge, so this is
  believed to predate A681 (not run on `main`). A681 puts the Theme row after Log out, so at 360×640
  and 390×664 that row is the part that needs a scroll. Decide whether More should show that it
  scrolls, or hold fewer items on a short screen.

- **At 320 px in CI's fonts the till's two Spanish tabs do not fit their strip (found by A681's CI,
  2026-10-17).** With a counter-zone menu, `test-till (1)` of run 39069802267 measured the tab
  strip's content at 196 px in a 182 px box; locally the same check measured 178 px in 184 px. A681
  leaves the bar's markup as it is on `main`, so this is believed to hold on `main` too (not run
  there); the bar's design lets the tabs scroll sideways once everything else has moved. Decide
  whether 320 px should show both tabs in full, and if so add a 320 px case to the "shows every
  tab in full" check in `apps/till/src/widgets/till-shell.test.ts`.

- **A787. Profile values on an open till refresh only at a profile switch or a change of zones
  (left open by A768, 2026-10-17).** Form factor, capabilities, idle logout, starting screen and
  whether clocking is offered change the till's layout, so they are applied only where the till
  already lays itself out again (A768's default; the owner has not decided). Decide whether any of
  them should follow a profile edit made on the dashboard while the till is open.

- **A791. A restart of the till does not end the person's session, so the till guards each draft
  save itself (left open by A768, 2026-10-17).** After the till restarts to the lock screen with no
  sign-out (a refused device, for one), the next person's sign-in drops the drafts of the person
  before (`#dropOthersDrafts`, `apps/till/src/till-app.ts`). The new session cookie arrives with the
  login answer, a moment before the till runs that drop, so a save timer firing in between would go
  out as the new person (read, not run). The server takes the person from the session alone; a
  save that named its draft's person, refused when it differs, would close the gap in one place.

- **A792. Two smaller points A768's last review left (2026-10-17).** Signing out with a kept,
  unsaved order on a dead connection now waits up to 150 s before the till tells the server (the
  screen is already locked). Two of the checks that keep one person's order away from the next
  person have no test, and the sign-in drop compares with the person on screen rather than the one
  signed in. Read, not run: confirm each, then test or narrow it.

- **An element inside a shadow root attached after a drag starts keeps its own cursor rule during
  that drag** — left open by A642. The drag's override sheet is added to the document and to every
  open shadow root present when the drag starts; in a shadow root attached mid-drag, an
  element with a cursor rule of its own keeps it unless that rule reads `--reorder-drag-cursor`.
  **Next action:** decide whether it matters; if so, have `holdPageCursor`
  (`packages/ui/src/reorder-table.ts`) also reach shadow roots attached while it holds.
  [Decision](backlog/till.md#decisions-and-deliberate-limits)

- **A669 — an allergy at the table (owner, 2026-10-14; spec approved 2026-10-15).** The send
  routes, till prompts, kitchen copy/notices and floor signal remain. At the first Send, ask
  "Any allergies at this table?" on every table send path; the counter has no allergy step.
  [Detail](backlog/till.md#a669-an-allergy-at-the-table),
  [Spec](superpowers/specs/2026-10-14-a669-allergy-at-the-table-design.md),
  [mockups](backlog/mockups/a669-allergy-at-the-table/)

- **A773. Courses, groups and the pass (owner, 2026-10-16; ownership approved 2026-10-17).**
  **A773-1**, the table screen's Sent/New order panel, remains unlanded. Its
  [plan](superpowers/plans/2026-10-16-a773-1-unsent-list.md) preserves checkpoints through
  `d17d4571`, including Recall/cancellation/refund, models, payment guards, closed-bill gating and
  target recovery. Single-dish Fire now's command/API/client work is qualified on the feature
  branch at `e65f6005e`; its visible sent-line menu follows in T16.
  The approved [ownership design](superpowers/specs/2026-10-17-a773-one-editor-design.md) is
  **one editor per bill**: Ana can edit Bill 1 while Luis edits Bill 2 at one table. Takeover,
  read-only/local unsaved recovery, first accepted nonempty save and release are per bill; Pay
  checks only its own bill. Shared firing/serving stays shared. Join/move conflicts require explicit
  needed takeovers. T24 and its affected-task map add concrete ownership/version/route/recovery
  contracts and floor bill/editor pairs. Ownership remains to build; this docs revision verifies
  no product behavior. The empty-bill first-save rule and three exact EN/ES messages have final
  approval after the relay correction; five earlier Pay name/count strings are withdrawn. Twelve
  cancellation translations stay approved; English Void/Comp naming stands.
  **A773-2**, firing and the pass, is planned after A773-1 lands: Requested/pass release, Away/Done
  removal, station settings and counter changes. The [six choices](backlog/mockups/a773-1-open-points/README.md)
  are answered in spec §14. Physical trials and the remaining panel/actions/finish/delivery work
  stay open. [Detail](backlog/till.md#a773-courses-groups-and-the-pass),
  [Spec](superpowers/specs/2026-10-16-a773-courses-and-groups-design.md),
  [course mockups](backlog/mockups/a773-courses-and-groups/),
  [panel mockups](backlog/mockups/a773-order-panel/),
  [ownership pictures](backlog/mockups/a773-one-editor/)

- **Later, after A773: a station waits for another station's part of a group (owner,
  2026-10-16).** For example, the bar pours the dessert wine when the kitchen marks the tarta ready,
  rather than when the waiter fires the group. A773 starts both parts together and marks the bar's
  part "Goes with kitchen food". Try it once a venue has run with that.
  [Spec §5](superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#5-firing-and-the-pass)

- **A738 — the counter screen: fewer distractions (owner, 2026-10-15; open; A182 part 1 for the
  counter till).** Top bar Counter, Floor | Held, Waiting, Transfers, Pass | ☰, with the rest in ☰
  and Kitchen only under Testing. After A668's data shape. How a later addition to a table is
  grouped and sent is A773's, not A738's.
  [Detail](backlog/till.md#a738-the-counter-screen-fewer-distractions), [mockups](backlog/mockups/a737-a740-till-counter-redesign/)

- **A739 — paying: Hold · Pay and one payment window (owner, 2026-10-15; open).** Pay opens one
  window: how much (An amount, Split equally, Items, Whole bill), the reader and printer (Change,
  Scan a QR sticker, or tap NFC), the receipt (print, email or none, language, full invoice),
  then Cash or Card. The simulator asks Declined/Approved at Card; Decline not declining is
  reproduced and fixed; the Demo card reader goes; no receipt screen after paying. After A738.
  [Detail](backlog/till.md#a739-paying-hold--pay-and-one-payment-window), [mockups](backlog/mockups/a737-a740-till-counter-redesign/)

- **A678 — Two readers answer "where is this order" (2026-10-14; open).** `readOrderPlaces`
  (used by MOVED slips) reads a counter order whose delivery table was released as the counter,
  while `orderTableLabels` (used by tickets and correction slips) names it by its kept
  `delivery_table_label`. Once the edge is decided, one reader in
  `packages/db`. Left open by A650 Part 1.
  [Detail](backlog/till.md#a678-two-readers-answer-where-is-this-order)

- **The comment above `fitPlaceholder` (`apps/till/src/widgets/fit-placeholder.ts`) says whole
  names are kept "where one fits", looser than what it does at the edge.** Left open by A665.

- **A666 — A floor join that moves tables together is sent once without seats and refused before
  the Seats prompt opens (2026-10-14; owner decided 2026-10-17).** It first sends the merge or
  join with no seat count, gets `400 merge.seats_required`, then opens the Seats prompt and sends
  again. Owner, 2026-10-17: ask for the seat count first and send once; the other refusals (table
  not free, already grouped, zone mismatch) then show only after the seats are typed. Done when a
  floor join that needs seats asks for them before its first request and sends once.
  [Detail](backlog/till.md#a666-a-floor-join-that-moves-tables-together-is-sent-once-without-seats)

- **Move this bill still offers a closed counter area (2026-10-15; open, A697 review).**
  The table picker always offers The counter (`#tablePicker`,
  `apps/till/src/screens/till-table-order-screen.ts`). Give the screen the counter area's identity
  and apply that rule, preserving same-area moves and presented bills.
  [Detail](backlog/till.md#move-this-bill-still-offers-a-closed-counter-area)

- **Held-order closed-area destinations need the order's source area (2026-10-15; open,
  A697 follow-up).** Neither `HeldOrderSummary` nor `HeldOrder` includes the saved source area
  (`apps/till/src/api/client.ts`). Include that context in the read contract, then filter closed
  destinations while preserving same-area moves.
  [Detail](backlog/till.md#held-order-closed-area-destinations-need-the-orders-source-area)

- **A730 — The floor's Rename window may keep comparing against the name it opened with after the
  name is changed on another till (2026-10-15; open; found by reading in A717's review, not probed).**
  **Next action:** probe it in real Chromium; if Save compares against the old name, follow the
  stored name as `party-name-dialog.ts` does.
  [Detail](backlog/till.md#a730-the-floors-rename-window-may-keep-comparing-against-the-name-it-opened-with)

- **A559. The till's full-invoice dialog changes width when an error appears.** It takes the width
  of its content: at 1280 px in English it grew from about 274 to about 348 px when A231q looked at
  it, and at 390 px the customer's name is cut short. A fixed width for its fields, as the find-bill
  dialog has (`apps/till/src/widgets/find-bill-dialog.ts`), would widen it to about 576 px — a
  decision for the whole dialog. Left open by A231q.

- **Investigate a null device identity during profile switching.** A432's full till coverage run
  on 2026-10-08 logged an unhandled rejection through `#readIdentity` / `#enterSwitchedProfile`.
  Reproduce which profile-switch test answers null. Cause unverified.
  [Detail](backlog/till.md#investigate-a-null-device-identity-during-profile-switching)

_Formerly A4; part of A9._ Detail: [backlog/till.md](backlog/till.md).

- **An unpaid table bill shows two "Full invoice" buttons**: the payment panel's own
  (`till-tender-pay`) and the bill's smaller one (`#billChoices`,
  `apps/till/src/screens/till-table-order-screen.ts`), both drawn since A231 (#1256). While full
  invoices are switched off neither is drawn (A741), so the question is for when they are on.
  **Next action:** draw both placements for the owner to pick which one stays (owner, 2026-10-17).

- **The device delete dialog's sign-in count is not live**: `sessions` is not a declared live
  table (`apps/dashboard/src/api/live-queries.ts:75-92`), so a sign-in or sign-out while the
  dialog is open does not by itself update its count; the delete itself recomputes. Left open by A435 step 4.

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
    `station-queue.ts`, from #131). `GET /api/till` never sends `stripe_on_device`, so the
    offline-consent toggle cannot appear.
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

- **Seating a booking at a table in a zone that is not a table-tab zone has no bookings test** —
  found by #574 while pruning comments (`packages/bookings`). The server accepts an empty contact
  name; only the dashboard form refuses one.
  [Detail](backlog/till.md#seating-a-booking-at-a-table-in-a-zone-that-is-not-a-table-tab-zone-has-no-bookings-test)

- **The bookings seat picker keeps a table it no longer offers** — OPEN (found 2026-09-23, writing
  bookings' coverage tests, PR #503). **Next action:** decide what the picker does when its tables
  change under it (re-pick the first, or close) and fix it test-first.
  [Detail](backlog/till.md#the-bookings-seat-picker-keeps-a-table-it-no-longer-offers)

- **A booking or a seated party can count more than 999 guests, which a simplified receipt
  recorded since A663 Part 3b never prints** (found by Part 3b). Bookings refuse only a party size
  below 1, and seating one passes it on unchecked; the guests count stored for such a receipt is
  bounded 1 to 999, so such a party's simplified receipt prints no guests line. [Detail](backlog/till.md#a-booking-or-a-seated-party-can-count-more-than-999-guests)

- **Three till handlers still leave a failed list refresh unhandled** — OPEN (found 2026-09-25,
  review of PR #641). `#onAdvanceTicketItem` and `#onRetrieveOrder` (`apps/till/src/till-app.ts`)
  await their list refresh after their `try`/`catch`, outside it, and `#onMarkCollected` awaits
  `#refreshStationQueue()` after a failed collect in a `try`/`finally` with no `catch`. **Next
  action:** decide what each shows when that refresh fails.
  [Detail](backlog/till.md#five-till-handlers-still-leave-a-failed-list-refresh-unhandled-and-one-a11y-file-may-not-render-its-screen)

- **The till's idle-timer check may be unreachable — OPEN (found by W24's review, 2026-10-03, by
  reading, not run).** `session-activity.ts`'s `#shouldRunIdleTimer` keeps the `this.#active &&` check
  that `#shouldHoldWakeLock` lost, and its callers look the same. **Next action:** remove the check
  with a receipt, as W24 did for `#shouldHoldWakeLock`, or keep it by decision.

- **Cash handed back for a voided cash sale is recorded nowhere** — OPEN (found 2026-09-24 by #605).
  A void writes no payment or refund row, so if staff give a customer cash back, the void's day
  shows a drawer shortfall at cash-up. **Owner decision 2026-09-25:** keep it here and decide it
  when the till's void screen is designed.
  [Detail](backlog/till.md#cash-handed-back-for-a-voided-cash-sale-is-recorded-nowhere)

- The dev `?dev` chooser shows `label · kind` rather than `name · profile`.

- **A837. The till calls a counter till "Caja registradora", as the dashboard does (owner,
  2026-10-17).** The till's `device.type.till` reads "Caja de mostrador"
  (`apps/till/src/i18n/strings.ts`); the dashboard's two labels read "Caja registradora". Change
  the till's string to match. Done when the till's Spanish string reads "Caja registradora".

- Recorded, not blocking: a handheld's Order tab is tappable with no active table; Counter has no
  prep-queue rail.

- **A re-sent "place" on an already-placed order answers 409 rather than replaying the original
  result — leave it, or build the replay?** — a product decision to take before production. Placing
  files no invoice (`placeOrder`, `apps/server/src/working-order.ts`). The gain if built is that a
  re-tap after a lost response moves the till on as placed instead of showing an error.
  [Detail](backlog/till.md#a-re-sent-place-on-an-already-placed-order-answers-409-rather-than-replaying-the-original-result--leave-it-or-build-the-replay)

- **`apps/till/src/till-app.ts` decides permanent-refusal / known-code / unknown at six call sites;
  a helper would collapse it.** Cosmetic, and cheapest alongside A848 (the empty-order message) that
  touches `#onPayTab` (under _Payments and card readers_). Raised by the A1 review wave (A1d).

- **Loose ends left by A395 (#1435) and A425, the till's one-row top bar.**
  - Open, decided as built: a change in the pending-transfer count alone never brings items back
    onto the bar, so when the count shrinks or goes away, items can stay in More although they
    would now fit, until the next resize or other change refits the bar.
  - Three lines in `apps/till/src/widgets/till-shell.ts` are pinned by no test: the phone-width
    early return in `#release`, the return after re-adding a step in `#fit`, and the unobserve of
    a replaced language chooser. Re-run those controls against the extracted shell before relying
    on them.
  - Three till top-bar cases run close to, and sometimes past, their 15 s limit locally: the "fits
    as a fresh bar does when …" cases in `apps/till/src/widgets/till-shell.test.ts`; find what
    makes them slow rather than raising the limit (A425).

  [Detail](backlog/till.md#the-tills-top-bar-is-one-row-at-every-width-a395-1435-left-open)

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

- **Loose ends left by A413 (#1436, the Devices screen and Add a device).**
  - The native dialog's accessible name is tested, but actual screen-reader speech is unverified.
  - Unassigned Profile cells stay blank; the None profile filter selects them. No cell-wording
    change was queued.

- **Loose ends left by A429 slice 5.**
  - Tighten the till's `TableState.today` type: slice 5 keeps it nullable for now
    (`apps/till/src/api/client.ts`), even though the floor's in-service read requires today's row.
    Check all consumers and fixtures before making it required.
  - Retire the till's unused `GET /api/tables` route: the app reads `/api/tables/state`;
    `apps/till/src/api/client.ts` has no method for the older list route. Check other callers
    before removing the route (slice 5, decision 15).

- **Loose ends left by A466 (A429 slice 2) / A502 part 3.**
  - `wt-input` has no visible description: the Add tables names preview is a polite live region
    after Prefix, so it is not heard when the field takes focus.
  - On computers whose scrollbars take space, a size reading just after a floor plan drop may
    shift the plan by the extra room.
  - Resizing a floor plan table needs a pointer or a keyboard, so a screen-reader user on a touch
    screen cannot resize a table (accepted by the A502 coordinator, not yet by the owner).
  - Small floor plan canvas details: `reveal` does not count the side dots or the corners.

  [Detail](backlog/till.md#loose-ends-left-by-a466-a429-slice-2--a502-part-3)

- **Loose ends left by A672.**
  - No key moves a floor plan table's top or left side or a corner. Shift with the arrow keys
    moves only its right and bottom sides.
  - Turning a floor plan table by key walks it away from the plan's top-left edge. Each press
    steps a table that would poke past the edge back in from where the last press left it, and
    turning back never steps it out again: one full turn by key takes an 8 × 8 from (0, 0) to
    (2, 2). Part of the owner question in "A turned floor plan table narrower than its unturned box
    stops short of the plan's left or top edge".
  - Two floor plan keyboard tests (zoom-out, half-zoom Shift+ArrowLeft) still pass with the
    far-edge protection switched off.
  - Possibly, not established: zooming out during a keyboard change grows the blank margin above
    and left of the plan.

  [Detail](backlog/till.md#loose-ends-left-by-a672)

- **Loose ends left by A718.**
  - `wt-floor-plan-preview` has no product user. It remains in `packages/ui/demo/main.ts`, with
    its token and its row in `docs/developers/design-system.md`. Retire it, or record why it is
    kept.
  - Check "closing the editor returns focus to its originating row menu" in
    `docs/developers/design-system.md` (Departments and zones): a review saw focus return to the
    Receipt link, which A756 has since removed; the department dialog still opens from the row
    and from "Set up the tax-agency description".
  - The pinned Actions column's left divider showed a gap between two zone rows in a 1280 px
    light-theme screenshot of Departments and zones. Not known whether it predates A718.

  [Detail](backlog/till.md#loose-ends-left-by-a718)

- **A470 — the till's floor map follow-ups (2026-10-10).** Small gaps the till's map left: an
  unmeasured screen-reader activation and two wordings. Left open by A429 slice 3.
  [Detail](backlog/till.md#a470--the-tills-floor-map-follow-ups)

- **A474 — today's floor changes on the till: follow-ups (2026-10-11).** A booking seated from
  the dashboard skips the taken-off check, the map's drag works out its target the slow way, and
  smaller gaps. Left open by A429 slice 4 (#1526).
  [Detail](backlog/till.md#a474--todays-floor-changes-on-the-till-follow-ups)

- **A drag that grows the till's plan in proportion refits nothing** — left open by A766 (#1824).
  When no move of a drag changes the plan's ratio, say 12 × 8 squares straight to 15 × 10 in one
  move, nothing resizes or refits the map, during the drag or at release, and the held table can
  be drawn past the map's edge.

- **After the till's map rescales mid-drag, the drawn table lags the finger** — left open by A766
  (#1824); seen on the demo stack (`~/waitron-campaign-b/a766-shots`). A refit during a drag moves
  the drawn table out from under a still finger.

- **A pan or zoom on a hidden till map is believed to divide by zero** — raised by A766's review
  (#1824), not run. A hidden map refits to a scale of 0, and `#moveView`
  (`packages/ui/src/components/wt-floor-map.ts`) divides by the view's scale; `git blame` puts that
  code before A766. A766 guarded only a drag's move at scale 0.

- **A561. A 2 × 2 table's name is cut short on the till map (2026-10-13).** It shows "Cou…".
  [Detail](backlog/till.md#a561-a-2--2-tables-name-is-cut-short-on-the-till-map)

- **A562. A 2 × 2 table shows no name in the floor plan editor (2026-10-13).** Its name waits on
  A561's decision; seen more since tables come back at their kept size (#1604).
  [Detail](backlog/till.md#a562-a-2--2-table-shows-no-name-in-the-floor-plan-editor)

- **A563. The till says "part of a joined table" for a joined table that has come apart
  (2026-10-13).** `table.in_joined_table` covers both cases since #1604.
  [Detail](backlog/till.md#a563-the-till-says-part-of-a-joined-table-for-a-joined-table-that-has-come-apart)

- **A590. Splitting a table from the order screen drops the room's new revision
  (2026-10-13).** Left open by A579 part 2b (#1624); the floor re-reads straight after.
  [Detail](backlog/till.md#a590-splitting-a-table-from-the-order-screen-drops-the-rooms-new-revision)

- **A591. A split down to one loses a table that had guests when its joined table went live
  (2026-10-13).** It is off the map once they leave. Reset table still reaches it; a room's reset
  no longer does. Found by A579 part 3a's review.
  [Detail](backlog/till.md#a591-a-split-down-to-one-loses-a-table-that-had-guests-when-its-joined-table-went-live)

- **A592. A party that joins a group's table names the group's other tables in random order
  (2026-10-13).** Group members are written in table-id order; number order remains open. A618
  makes same-time reads follow writing order. Seen in A579 part 3a's tests.
  [Detail](backlog/till.md#a592-a-party-that-joins-a-groups-table-names-the-groups-other-tables-in-random-order)

- **A593. A table the reset turns into a joined table inside a waiting group keeps its old outline
  (2026-10-13).** Narrower than its tables; a split lays them out from its left edge. Left open by #1626.
  [Detail](backlog/till.md#a593-a-table-the-reset-turns-into-a-joined-table-inside-a-waiting-group-keeps-its-old-outline)

- **A594. Moving a bill to a free table in a group seats only that table (2026-10-13).** The party
  holds part of the group, and can lose the group's today's name with no MOVED slip. Found by A579
  part 3b's review.
  [Detail](backlog/till.md#a594-moving-a-bill-to-a-free-table-in-a-group-seats-only-that-table)

- **A598. A table held by guests when its joined table went live is neither joined nor split off
  (2026-10-13).** So the till cannot see that the rest will not rejoin; it asks Seats only after the
  server refuses. Reset table still reaches it. Found by A579 part 3c's review.
  [Detail](backlog/till.md#a598-a-table-held-by-guests-when-its-joined-table-went-live-is-neither-joined-nor-split-off)

- **A603. Reset table does not wait for food on its way to a group's other tables, nor for a table a
  module refuses to remove (2026-10-13).** The floor-wide reset waits for the second. Found reading,
  not run, in A579 part 4b's reviews.
  [Detail](backlog/till.md#a603-reset-table-does-not-wait-for-food-on-its-way-to-a-groups-other-tables-nor-for-a-table-a-module-refuses-to-remove)

- **A604. A split-off table the till's read leaves out could make Reset table refuse as out of date
  (2026-10-13).** Not known to be reachable. Found reading, not run, in A579 part 4b's review.
  [Detail](backlog/till.md#a604-a-split-off-table-the-tills-read-leaves-out-could-make-reset-table-refuse-as-out-of-date)

- **A565. A reset does not wait for food on its way to an ordinary table (2026-10-13).** Dates
  from floor plans slice 1; #1604 made only split groups wait.
  [Detail](backlog/till.md#a565-a-reset-does-not-wait-for-food-on-its-way-to-an-ordinary-table)

- **A566. An open order with nothing sent yet does not hold a split group back at a reset
  (2026-10-13).** Left open by #1604.
  [Detail](backlog/till.md#a566-an-open-order-with-nothing-sent-yet-does-not-hold-a-split-group-back-at-a-reset)

- **A567. An edit to the recorded layout of a waiting joined table can shift where its tables
  land (2026-10-13).** Accepted for now in #1604; Reset table (A579) lays out from the same slots.
  [Detail](backlog/till.md#a567-an-edit-to-the-recorded-layout-of-a-waiting-joined-table-can-shift-where-its-tables-land)

- **A568. A part placed on today's map while its joined table waited keeps its place
  (2026-10-13).** Until the next reset; the till hides it. Left open by A503 part 2 (#1601).
  [Detail](backlog/till.md#a568-a-part-placed-on-todays-map-while-its-joined-table-waited-keeps-its-place)

- **A569. The floor plan editor's Made of picker and wrapping (2026-10-13).** The inline picker
  and how its parts wrap remain open; Add button placement now follows A671.
  [Detail](backlog/till.md#a569-the-floor-plan-editors-made-of-picker-and-two-wraps)

- **A turned floor plan table narrower than its unturned box stops short of the plan's left or top
  edge.** An 8 × 4 turned 90° stops 2 squares from the left edge, because its saved corner cannot
  go below 0. Owner question asked 2026-10-16; (a), keeping it so, is built. Left open by A672.
  [Detail](backlog/till.md#a-turned-floor-plan-table-narrower-than-its-unturned-box-stops-short-of-the-plans-left-or-top-edge)

- **A570. A table split off a joined table whose removal was refused cannot be moved
  (2026-10-13).** Refused Back, Take off and Reset table. Left open by A503 part 4 (#1608).
  [Detail](backlog/till.md#a570-a-table-split-off-a-joined-table-whose-removal-was-refused-cannot-be-moved)

- **A571. A joined table that came apart cannot reach Reset table when its free tables are off the
  map (2026-10-13).** The reset still puts it back. Left open by #1608.
  [Detail](backlog/till.md#a571-a-joined-table-that-came-apart-cannot-reach-reset-table-when-its-free-tables-are-off-the-map)

- **A572. Reset table puts back a joined table with its full seats while a table its layout adds
  still has guests (2026-10-13).** None asked. Left open by #1608, kept by A579.
  [Detail](backlog/till.md#a572-reset-table-puts-back-a-joined-table-with-its-full-seats-while-a-table-its-layout-adds-still-has-guests)

- **A575. Reset table's window: two things seen in #1608's look (2026-10-13).** A Spanish wrap,
  and where the stays-apart lines sit.
  [Detail](backlog/till.md#a575-reset-tables-window-two-things-seen-in-1608s-look)

- **A550. Making a booked table part of a joined table is not refused (2026-10-12).** The floor
  plan editor's save refuses deleting a booked table (`table.booked`) but not making one a part.
  Next: decide whether the save refuses it, as a delete is refused, or only warns.
  [Detail](backlog/till.md#a550-making-a-booked-table-part-of-a-joined-table-is-not-refused)

- **The booking form draws its bottom alert and Save slot without the shared actions primitive
  (2026-10-14, A551 review).** `packages/bookings/src/dashboard/booking-form.ts` keeps a
  `p.error[role=alert]` and its footer button where the Forms contract in
  `docs/developers/design-system.md` names `wt-form-actions`.
  [Detail](backlog/till.md#the-booking-form-draws-its-bottom-alert-and-save-slot-without-the-shared-actions-primitive)

- **A545. Deleting a zone: two of its deletes are not what any test checks (2026-10-12).**
  `clear` in `apps/server/src/floor-delete.ts` deletes today's merges, but `removeLiveTables`
  (`apps/server/src/table-removal.ts:93`) has already removed them through `leaveMerges`; with
  those two deletes taken out, `floor-delete.test.ts` still passed 7 of 7 (A503 part 1, Task 2b).
  Next: delete them, or add a case that reaches them.

- **A856. A table that needs moving looks like one that needs clearing on the till's map
  (2026-10-18).** It takes the `clearing` fill; its words are on the list card, the Mark moved
  question and its accessible name. A marker of its own needs a new token pair or badge in
  `@waitron/ui`, an owner design decision. Left open by A504.

- **A857. A booking can take a table the evening's layout puts away (2026-10-18).** Bookings refuse
  a part of a joined table, and on the business day a zone has recorded a set for, also a joined
  table the last reset's copy leaves off while placing a part; on any other date, or under a record
  naming no set, every part and no joined table (`requireActiveTable`,
  `packages/bookings/src/bookings.ts`).
  Nothing compares the table with the layout due at the booking's time. Spec §11: the editor could warn, or the booking screen refuse. Left open by A504.

- **A858. No history of a zone's past layouts (2026-10-18).** A layout holds one place per table
  (`floor_plan_placements_table_key`), so a save overwrites the place before it. Spec §11 names
  it as a gap. Left open by A504.

- **A879. After Leave it here, bookings and the dashboard's table list still follow the last
  reset's copy, not today's map (2026-10-18).** Where the new layout joins 4 and 5, the dashboard
  list leaves out 4 and 5 and lists the off-map 4+5, and a booking today at 4 is refused
  `table.in_joined_table`, until the next reset. It was already so while they needed moving.
  Left open by A878.
  [Detail](backlog/till.md#a879-after-leave-it-here-bookings-and-the-dashboards-table-list-still-follow-the-last-resets-copy)

- **A880. Two tables pressed on the till's floor list at once: the second can be refused as out of
  date (2026-10-18).** Leave it here or Mark moved on one table, then on another before the first
  is answered, sends the same room revision twice, so the second can come back
  `floor_today.out_of_date`. Found by reading `#sendTodayAction`
  (`apps/till/src/screens/till-floor-screen.ts`); A878's finish-branch review reproduced it (a
  browser probe sent `t3` and `t4` with revision 6, and the server answered 200, then 409
  `floor_today.out_of_date`). Left open by A878.

- **A881. A till's refusal line vanished after the person's language was changed on another till
  (2026-10-18).** Seen in A878's scripted screenshot runs; whether the language change or something
  else in the same 20 seconds cleared it was not isolated. Next: reproduce, then decide whether a
  refusal should outlive it. Left open by A878.

- **A883. Back to its saved place's `table.place_taken` refusal does not name the tables
  (2026-10-18).** The till shows the code's own words ("Another table is in its place. Move it,
  then try again"), while Reset table's refusal under the same code names both
  (`#namedRefusal`). A sentence naming both tables needs new words in English and Spanish from the
  owner. Left open by A878.

- **A859. Floor plans and the till's layout banner: looks left to the owner (2026-10-18).** A504's
  look passes kept five things as built, as judgement calls.
  Left open by A504.
  [Detail](backlog/till.md#a859-floor-plans-and-the-tills-layout-banner-looks-left-to-the-owner)

- **At 390 px the Floor plans screen cuts period names in its "Used by" column.** Seen on the demo
  venue on 2026-10-18 by A783's look: a set's period chips are cut off by the column, both themes,
  English and Spanish (`floor-plans-{light,dark}-390[-es].png` in `~/waitron-campaign-b/a783-shots/`;
  `packages/venue-service/src/dashboard/floor-plans-screen.ts`). Left open by A783.

- **A860. A floor-check rule copied four times (2026-10-18).** Whether a table's new place is
  taken is decided in four places, in TypeScript and in SQL, each excluding a slightly different set
  of tables. Next: share one verdict, or pin the copies as matching. Left open by A504.
  [Detail](backlog/till.md#a860-a-floor-check-rule-copied-four-times)

- **A508. A table's QR code: order, call a waiter, ask for the bill or pay (owner, 2026-10-11).**
  When a tab is opened for seated guests, a QR code is printed for them; on their own phone it
  opens the menu to order from, a button to call a waiter, and one to ask for the bill or pay
  online. Backlog only, not queued to a lane.
  [Detail](backlog/till.md#a508-a-tables-qr-code-order-call-a-waiter-ask-for-the-bill-or-pay)

- **A509. Online ordering for collection at the counter (owner, 2026-10-11).** A customer orders
  from the venue's online menu and collects at the counter. Needs the internet, as A508 does.
  Backlog only, not queued to a lane.
  [Detail](backlog/till.md#a509-online-ordering-for-collection-at-the-counter)

- **Loose ends left by A429 slice 1 (#1493).**
  - The bookings list shows no table for any booking, and a past booking's kept table name
    (`bookings.table_label`) is stored but shown nowhere.
  - A walk-up counter sale delivered to a table in a table-service zone may become a table tab
    whose payment sends nothing to the kitchen (unverified, read only): `createOpenOrder`
    (`apps/server/src/working-order.ts`, from #297) replaces the order's zone with the delivery
    table's. Whether the till can offer such a table was not checked.
  - Nothing at boot level tests that the till API receives the table-removal seats (each enabled
    module's part in removing a table); `apps/server/src/boot.test.ts` tests only the management
    API's wiring.
  - Small floor-plan refusals still missing: `dining_tables.plan_table_id` has no unique index (no
    writer makes two live tables follow one master table today); the delivery-release trigger
    accepts an empty label.

- **A phone's Chrome drew a white page for the box (2026-10-08; watch, not a job yet).** Quitting
  and reopening Chrome fixed it; what to capture if it recurs is in the detail.
  [Detail](backlog/till.md#a-phones-chrome-drew-a-white-page-for-the-box-watch-not-a-job-yet)

- **Two small phone-width points A414 left (#1495).** On the Order screen at 390 px the Review
  button stops short of the right edge; the Schedule screen draws its own copy of
  the card's border and padding.
  [Detail](backlog/till.md#two-small-phone-width-points-a414-left-1495)

- **A436 — a kitchen display with someone signed in, logged out only after a long idle time** (owner,
  2026-10-08, answering the A366 slice 5 plan; open). The owner: "kitchen
  displays can have a login, but i would not expect them to log off automatically, or at least
  only after an extended logout time (eg 30 minutes)". Today nobody can sign in on one. Left out
  of slice 5 as too large for it.
  [Detail](backlog/till.md#a436--a-kitchen-display-with-someone-signed-in-logged-out-only-after-a-long-idle-time)

- **Loose ends left by A366 slice 5 Part A (#1479).**
  - Duplicating a till or handheld profile whose station list holds only switched-off stations is
    refused with the general `device_profile.access_invalid` message. The copy drops switched-off
    stations and the server refuses the emptied list; keeping them would need the create route to
    know it is making a copy.
  - Two device choices can lose a switched-off entry. A returning device accepted in Pair starts
    without its switched-off stations and zones; and in Devices → edit a kitchen screen kind the
    profile no longer shows is dropped from the draft, so it is lost if the choice is changed and
    saved.
  - A profile's explicit station and zone lists for its kitchen screens hold only the saving
    location's ids, so saving the profile at one location empties another location's lists and,
    now that a narrowing is allowed, narrows that location's devices. The flat station list these
    lists replace was saved the same way, from W97 (#1311).

- `service_commands` rows are never pruned. Left open by service Task 2 (#715, a record per seated
  party).

- **Loose ends left by service Task 3 (#733, order groups).** A cross-party merge can leave a
  settled check's lines naming a group now on the target party; three more points are in the
  detail. [Detail](backlog/till.md#task-3-733-order-groups)

- **Loose ends left by service Task 4 (#748, the table screen works with order groups).**
  - Group summaries come from the server, so a weighed quantity shows a dot decimal in Spanish (a
    summary shows only when Current orders cannot be read).
  - Group numbers are the server's positions, so the list can read "Group 1, Group 3"; the preview
    gives counts, not contents.
  - The screen's older small buttons are 32 px tall, under the 44 px tap target.
  - Per-line Send and Change have no guard against a second press while the first is running
    (Cancel has one since B11a; the group commands have one).

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group).**
  - A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
  - Every pass press moves the party's revision, so a waiter's open Tab drawer meets
    `party.out_of_date` after it and reads again.

- **Loose ends left by service Task 7 (#789, each person's draft kept on the server).** A draft
  that moves to the other party in a merge records no history event; the server's own
  `unavailable` flag misses some lines that are refused at submission; and three rulings made on
  the branch are for the owner to confirm.
  [Detail](backlog/till.md#task-7-789-each-persons-draft-kept-on-the-server)

- **Loose ends left by service Task 8 (#806, the till works from the server's drafts).** An edit
  can be lost at sign-out without a message; a send cut off by the 150-second limit is not sent
  again; drafts are not pushed to other tills; and the map tag says "Unsent" but not whose.
  [Detail](backlog/till.md#task-8-806-the-till-works-from-the-servers-drafts)
  - Seating a table whose answer arrives while a newer table is still opening shows the seated
    table briefly before the newer one replaces it.
  - A refused seat leaves the till pointing at the refused table.
  - If the screen widens while Back on the Review view has focus, focus goes to the page.
  - A dish no longer on the menu shows an empty name on its tick button in the person's own draft,
    and in the spoken names of its course picker and Split quantity button (read in the code, not
    run).
  - The last-added bar is empty for a draft read back from the server until the next tap, and does
    not follow a weighed line when the server's answer replaces the lines.
  - While a weight is being entered, the weight entry covers the bottom of the menu and the bar.
  - "Review (N)" counts items (Beer ×2 counts 2), while the floor's mark counts lines and calls
    them "items", so the two can differ for one draft.
  - Keep lasts only until the server's answer rebuilds the lines; a kept line then asks Remove or
    Keep again.
  - A dish no longer on the menu, saved at a whole quantity, counts by that quantity on Review; its
    unit is unknown, so a weighed one saved at exactly 2 kg counts 2.
  - The counter's basket also tracks its last-added line, which it does not use.
  - The server's "cannot be sold" mark is dropped once the till's newer menu read passes the line.
    That the two checks agree was read, not run.
  - Every line priced under an older menu version is asked about whenever the server's draft
    replaces the till's lines (a reload, a re-read, a take-over).
  - A line naming a version the till does not hold costs one more read of the table's menu.
  - The "The menu has changed" dialog shows a focus ring round the whole dialog box.
  - Tests: the accessibility test "has no violations with the round grid, the per-line course
    picker and the open tab drawer" no longer scans the menu grid (a phone test does), but kept
    its name.
  - Rulings made on the branch for the owner to confirm.

- A line outside any group that needs no kitchen, held, and first released after its bill was paid
  could not be marked served (`group.line_held`), because `stampSent` wrote `sent_at` only on an
  open bill. Since B21 (#969, core `0053`) `stampSent` writes on any bill but an abandoned one;
  whether this case is now served was not measured. Left open by service Task 9 (#814, served by
  quantity, release reminders, Current orders).

- **Loose ends left by service Task 10 (#908, the service dashboard's attention signals).** For the
  owner. [Detail](backlog/till.md#task-10-908-the-service-dashboards-attention-signals)
  - The floor's older waiting band (`timingBand`) still counts HELD dishes, while the long-wait
    chip counts only dishes sent to the kitchen. **Next action:** decide whether `timingBand`
    should also count only dishes sent.
  - The "Take order" chip looks like the "Reserved" badge, and the "Bill requested" chip like the
    "N en camino" badge. **Next action:** decide whether the chips get tones of their own.
  - The till drops the bill request's late answer, a refusal included, once the waiter has signed
    out or left the party (`#onRequestBill`, `apps/till/src/till-app.ts`). **Next action:** decide
    whether a late refusal should be said.

- **Loose ends left by service Task 11 (#916, cancellations, comps and discounts; B11a–B11g).**
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)
  - **The adjustment history records who approved, but not whether the bill's discount limit,
    rather than the reason, is why.** **Next action:** decide whether to record it.
  - **A placed pay-later counter order (a `ticket_then_pay` zone's, sent to the kitchen before
    it is paid) cannot be adjusted.** **Next action:** decide whether a placed order can be
    adjusted before it is collected.
  - **The server's held-order edit (`PUT /api/working-orders/:id`) still voids a sent dish's
    dropped quantity without a reason** (`applyLineEdits`, `apps/server/src/working-order.ts`).
    **Next action:** decide whether the edit should refuse dropping a sent line.
  - **Two basket changes the app makes by itself do not check the edit lock:** the menu poll's
    price-version update of the basket's lines (`adoptLines`) and the order's label. **Next
    action:** decide whether the two should wait for the lock.
  - **Nothing on screen shows the lock.** **Next action:** dim the basket, or show a one-line
    note, while `editsLocked` is set.
  - **A reason's percentage limit can be exceeded** by combining a bill discount with a line
    discount, or two bill discounts under one reason. **Next action:** decide whether the per-line
    cap should see bill discounts.
  - For an extra of a held dish whose HOLD ticket was queued, cancelling it tells the kitchen
    (B11g) but the till's cancel dialog still says only that it comes off the bill. **Next
    action:** decide whether the till should be told that.
  - An extra counts its dish's percentage under a reason's per-line cap, and a dish the largest of
    its extras', which errs toward refusing. **Next action:** none unless staff find it gets in the
    way.
  - **Only give-aways and discounts split part of a dish with its extras.** Splitting a bill,
    transferring items and moving part of a dish to another group still refuse a partial move of a
    dish with extras (`tab.transfer_modifier_line`). **Next action:** decide whether those partial
    moves should split extras too.

- The till's "Amount off (€)" writes the euro sign into the label rather than taking the venue's
  currency. How a comp or discount appears on the invoice is still asesor Q29. Left open by service
  Task 11 (#916).

- `PUT /api/working-orders/:id/lines/:lineNo` reads only the fields it names, so a `frozenExtras`,
  `frozenOptions` or `productId` sent there is ignored rather than refused as the other till routes
  now do (#1531); nothing is priced from them. **Next action:** decide whether it should refuse them
  too.

- **Loose ends left by service Task 16 (#981, counter handover).**
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)
  - **A collect straight after Place order does not re-read the kitchen queue.**
  - At login the counter's three lists are read one after another, so a read that hangs delays
    the rest (left open by B31, #1018). Load them side by side.
  - C130 (#1056): a till profile saved before C130, and one newly created on the Device profiles
    screen, has the three switches off until a manager turns them on; a till with no device reads
    no capabilities, so it shows none of the three buttons.
  - C130 (#1056): a change to a device profile reaches a till only when the till starts again — a
    page load, a move to another server or a re-enrolment, or in dev mode the lock screen's
    switch-device button — so signing out and in again does not pick it up.
  - C130 (#1056): on the handheld, the station screen's back button says "Back to counter" though
    a handheld on the built-in phone layout lands on the floor plan.
  - C133 (#1045): a staff list longer than the screen still makes the page scroll to reach the
    language button.
  - C133 (#1045): the table-order screen's bottom bar still keeps a tap target and two gaps clear
    at its end (`padding-inline-end` on `.bottom-bar`,
    `apps/till/src/screens/till-table-order-screen.ts`) for a floating language button the till no
    longer has. Removing the space changes the screen's layout, so it is its own change.
  - C133 (#1045): the till's `.submitted-toast` (`apps/till/src/till-app.ts`) still sits one tap
    target and two gaps above the bottom edge; decide whether it should drop to the bottom edge.

- **Loose ends left by service Task 17 (#991, a table that leaves without paying).**
  [Detail](backlog/till.md#task-17-991-a-table-that-leaves-without-paying)
  - **Collecting PART of the debt later is not built.** Collecting it in full uses
    `POST /api/working-orders/:id/collect`.
  - **The table screen still reads a credited presented bill at its full amount.**
  - **A bill presented without an invoice keeps the label it was placed with when the departure
    invoices it.** Fixing it needs that trigger to allow the label to change.

- **Gaps against the service plan's acceptance checks (spec §12)**, from a sweep on 2026-10-01: **No
  permanent test lays the service screens out at phone and till widths in both themes (§12 item
  14).** The axe scans run in both themes, mostly at the browser's default size with one block at
  390 px (`apps/till/src/screens/till-table-order-screen.a11y.test.ts`).

- **Loose ends left by C126 (cancelling an order whose invoice was issued credits it, #1030), B32
  (#1055) and B34 (#1077).**
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)
  - **The approver list is fetched with no time limit.** The unpaid-departure and refund dialogs
    fetch theirs the same way and predate B32; a time limit belongs on all three together.

- **A840. Can anything still reach the counter's Cancel and credit? Check, then clean up (owner,
  2026-10-17).** B34 (#1077) built it for a counter order invoiced when it was placed, and
  invoicing at placement was retired on 2026-10-06 (A261-2c, #1285); the button and its dialog
  text are still in the code. Find whether any path still reaches it. If none does, remove the
  button and dialog text and delete this entry; if one does, fix its three gaps: the result names
  no credit note, a cancel that gets no answer is never shown as done, and the button does not
  check for a payment on the order.
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)

- **Loose ends left by the table actions plan (Tasks 8, 10 and 11, #869, #875, #881; C77/C86;
  C84).** [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)
  - A party with no table whose chain of merges never ends (an unknown id, or two parties recorded
    as merged into each other, which the database accepts) is named by the bill's own label;
    whether any till action can make such a loop was not checked.
  - `party.main_bill_stays`'s till wording says "the table has other unpaid bills", which Split a
    table choosing the main bill need not satisfy.
  - Left by #906's review: `computeOverdueOrders` is the one report function that reads its own
    node's location rather than being handed one (adding `locationId` to `OverdueOrdersInput` was
    suggested, not done); no case pins what a correction slip prints for a counter order delivered
    to a table; and a database built on purpose with a delivery table in another location now
    names the order by its own label — no product path creates that state, and whether every
    existing venue database is free of it was not checked.
  - Unchecked Send to radios are Chromium's own dark-theme control, dim grey on the dark dialog
    (seen in the 390 px Spanish dark screenshot).
  - Open (found by #905's review, by reading, not reproduced): on a handheld, a waiter who taps a
    free table to seat it, goes back to the order tab while the seating is still under way and
    starts Move guests can have the move set the wrong table on the new party; the suggested fix
    is to count only table opens started in the current operator session; not queued.
  - The till sends `otherPartyId: null` when its floor does not list the target table at all (a
    failed floor read empties the list); a table another party holds is then refused as out of
    date, never combined.
  - On a 390 px phone the bill choice's buttons wrap ("Keep separate bills" on three lines).
  - **From C84's review (#913):** when a void or line change gets no answer, `#rereadAmounts()`
    can put on screen what the party still owes, taken from its bills after its own floor read
    failed, while the revision on screen stays where it was. Traced in the code, not reproduced.

- **Later: optional seat/guest item assignment (owner, 2026-09-20).** Include shared items when this
  is designed. For now, orders remain at table/tab level and staff select items manually when
  splitting bills; seat assignment is not a prerequisite for the service workflow.

- **Later: staff-to-table assignments (owner, 2026-09-20).** Design assigning responsibility for
  tables to staff, including handover and how assignments appear on the floor dashboard. The current
  workflow discussion assumes no assignments; they are not a prerequisite for the dashboard.

- **Diet badges still read undeclared caution and success text colours.** A668-5 removes the
  basket and kitchen reads from the original “Four till surfaces ask for a caution colour” finding.
  **Next action:** choose declared theme tokens or define the intended text tokens for
  `diet-badges.ts`, then remove its two `FALLBACK_READS` exceptions.
  [Original finding and remaining scope](backlog/till.md#four-till-surfaces-ask-for-a-caution-colour-that-is-defined-nowhere-so-all-four-render-as-plain-text)

- **Five measured till layout defects and one seen in a screenshot, all of them older than the
  extras-and-options work.** Found while looking at the real screens for B1 Task 12.
  [Detail](backlog/till.md#five-measured-till-layout-defects-and-one-seen-in-a-screenshot-all-of-them-older-than-the-extras-and-options-work)

- **Unchecked since the service plan's Task 8 (#806): whether a round entered while the floor was
  being re-read is still hidden when the till follows the party onto its next tab**
  [Detail](backlog/till.md#unchecked-since-the-service-plans-task-8-806-whether-a-round-entered-while-the-floor-was-being-re-read-is-still-hidden-when-the-till-follows-the-party-onto-its-next-tab)

- **The three displays walked end to end** — [ui-review.md](ui-review.md)'s areas, at the real box,
  as part of walking the box with the printers; with the owner present, after 2 November (owner,
  2026-10-17).

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

- **Design the fixed screens for each kind of device (A182 part 1, owner 2026-10-01).**
  Counter design and implementation remain A738–A739. The handheld, kitchen screen and pass were
  designed on 2026-10-18 as **A797**, waiting for the owner's answer to Q42 (lane C's questions
  file); nothing is built until then:
  [design](superpowers/specs/2026-10-18-a797-device-screens-design.md),
  [mockups](backlog/mockups/a797-device-screens/). A737 Part 2 adds the separate
  durable post-invoice payment-refund path. The screen designer was
  retired in [#1800](https://github.com/clintongormley/waitron/pull/1800) without redesigning those workflows.
  [Detail](backlog/till.md#build-good-screens-for-each-kind-of-device-and-retire-canvases-a182-owner-2026-10-01)

- **Loose ends left by A268 (add a device, like adding a printer, owner 2026-10-04).**
  - W105b (#1248, a disabled device coming back as itself): (1) the slow hash check runs only when
    the cookie names a disabled device, so the response time hints that an id is a disabled device;
    asks are rate-limited and, outside dev mode, accepted only while Add a device is open.
    [Detail](backlog/till.md#what-w105b-left-open-1248-a-disabled-device-coming-back-as-itself)
  - W106 (the battery on the Devices list, #1240): (a) the relative-time words (W106a, #1272,
    `wt-relative-time`) show the exact time in the BROWSER's time zone: the relative-time widget
    receives no venue time zone.
    [Detail](backlog/till.md#what-w106-left-open-the-battery-on-the-devices-list-1240)
  - W105 (#1235): review suggestions #1235 did not take.
    [Detail](backlog/till.md#what-w105-left-open-1235)
  - W104 (#1225), not acted on: (1) a Pair save that never answers locks both dialogs, because a
    save carries no time limit (`packages/dashboard-kit/src/request.ts` limits GETs only).
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

- **Rename the `seedTill` test fixtures** — deferred in the PR of A238 (a till is a device, #1164).

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

- **Three till loading lines may not be announced** (found 2026-10-03 in review of lane C's W23).
  The schedule screen (`apps/till/src/screens/till-schedule-screen.ts`, #1103), the lock screen and
  the device chooser each insert a `role="status"` element already holding the loading text and
  remove it when loading ends. **Next action:** decide whether to keep an empty status region on the
  page and fill it later, and test that sequence.
  [Detail](backlog/till.md#three-till-loading-lines-may-not-be-announced)

- **The till's four choice dialogs (`apps/till/src/widgets/`) each carry their own radio-option
  styles, which could be one shared set** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.

- **`apps/server/src/tables.ts` still translates every unique refusal in `createStatus` and
  `updateStatus` to a label collision** — left open by A261-2d (#1274), outside that zone item; a
  separate follow-up should identify each label key and force another-key clash.

- **Unresolved observation from W101 verification** — left open by W101 (#1351). Two full local
  `@waitron/till test:coverage` runs logged an unhandled rejection in `#holdIdentity` while
  `#switchProfile` was reading identity. The triggering test and cause are unverified; isolate the
  profile-switch case and its identity response before choosing a fix.
  [Detail](backlog/till.md#unresolved-observation-from-w101-verification)

- **Loose ends left by W97 (#1311).**
  - A card payment stuck `attempting` holds its device's profile switch until a manager resolves
    it on Payments. The till only says to switch once it finishes; point it at the Payments screen.
    [Detail](backlog/till.md#a-card-payment-stuck-attempting-holds-its-devices-profile-switch)
  - The till's Profile button shows whenever the device has more than one approved profile, read
    at boot: neither approvals added later nor the signed-in person's admission hide or show it
    until the dialog reads `/api/device/me` again.
    [Detail](backlog/till.md#the-tills-profile-button-shows-whenever-the-device-has-more-than-one-approved-profile)
  - The profile editor reads people and the venue's departments and zones, so it needs
    `person.manage` and `venue_service.manage` beside `layout.configure`; no role holds only the
    last today.
    [Detail](backlog/till.md#the-profile-editor-reads-people-and-the-venues-departments-and-zones)
  - `apps/dashboard/src/screens/device-profiles-screen.ts` is over 1,600 lines; "Where it serves"
    and "Who can sign in" could become widgets of their own.

- **Loose ends left by W100 (#1332).**
  - Its owner questions were answered 2026-10-07: every default kept (staff cannot switch a
    device's printing off; disconnected equipment is not shown).
    [Decision](backlog/till.md#device-equipment-defaults-w100-1332-owner-kept-every-default-2026-10-07)
  - If the till's last 15-second check said a reader was busy and that payment has since finished,
    picking it skips "Take it?" and the server refuses it as held, so staff pick again. Found by
    reading, not run.
  - If a profile switch succeeds but its reply is lost, a check sent before the switch can briefly
    show the old profile's reader until the next check. Found by reading, not run.
  - The till's equipment poll and menu poll are near copies and could share one class (left out of
    #1332 as too large).

- **Table states and signals (A267)** — OPEN, needs a design session (owner, 2026-10-03). From
  A261 §10. [Detail](backlog/till.md#table-states-and-signals-a267)

- **Handheld shared-table updates** — still queued: automatic table-content refresh while two
  waiters work on the same table. W101 supplies transfer-specific updates. Spec the wider
  subscription model when it matters.

- **A841. A theme editor (owner, 2026-10-17).** Lets the owner change how Waitron looks by setting
  the `--wt-*` CSS variables it already reads. Not designed yet. Next: a design.

- **Bookings**, each greenfield: public/online/QR booking, availability, reminders, a CRM entity,
  recurring, a calendar grid, deposits.

- **Show how many dishes are being made on the table plan — OPEN (3d, W16).** — left open by the
  product folders work. The plan has no such count; adding one needs another value from
  `listTablesWithState`.

- **Refresh the floor without a staff action in a zone's list view — OPEN (3d, W16).** — left
  open by the product folders work. Since A429 slice 3 the floor screen re-reads the floor every
  15 seconds while a zone's map is on screen. Polling would read `listTablesWithState` every few
  seconds on every till; choose the interval and cost first.
  [Detail](backlog/till.md#refresh-the-floor-without-a-staff-action-in-a-zones-list-view--open-3d-w16)

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
  name only, not a customer name. The till also searches displayed section names (A461).
  [Detail](backlog/till.md#the-tills-home-page-task-9-729)

- **One stale-answer window remains OPEN** — left open by #912's review (secret checks and the write
  lock): the two join-status readers answer from a hash read just before the key is derived, so a
  request denied or revoked in that window can get one stale `pending` or `approved`.
  [Detail](backlog/dashboard.md#secret-checks-and-the-write-lock-the-pin-manager-login-and-profile-checks-moved--done-w1-1117-two-blocking-derivations-and-one-stale-answer-window-remain-open)

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

- **A retained-course phone fixture clips the Back button's outline at the right edge.**
  A435 step 5's 390 px captures show it with the real till app and icons. Reproduce it through
  a normal till boot before changing layout; the fixture's cause and the base version are
  unverified. The retained course label and active-only picker are visible in the same captures.

- **The station dialog widens or narrows with the chosen station's name, so its buttons shift a
  little as a station is picked** (it did so before this batch). Left open by A331 batch 5 (#1414).

- **A842. While a payment is being sent, the pressed Cash or Card keeps its colour with a spinner
  (owner, 2026-10-17; left open by A535, #1617).** Both are switched off with `disabled` while
  sending, so in dark they turn dim blue. Follow the owner's 2026-10-08 rule: the pressed button
  keeps its own colour with a spinner while its request is sent, and the other goes quiet. Done
  when a test finds the pressed button in `loading` with its own colour, and the other one quiet,
  while the payment is sent.
  [Detail](backlog/till.md#in-dark-the-tills-cash-and-card-turn-dim-blue-while-a-payment-is-being-sent)

- **Check leading-zero tip drafts on the counter payment screen.** The draft comparator in
  `apps/till/src/widgets/tender-pay.ts` calls the strict decimal reader on raw text and falls back
  to text equality when that refuses it. A599's review probe observed `shared.invalid_decimal`
  for `"00"` and `"05.50"`; the effect on the form's unsaved-change prompt is unverified.
  Next: reproduce through the form whether equivalent tip spellings ask to discard a change.

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

- **A843. Retire `GET /api/products` and move the till's tests onto zone-offer fixtures (owner,
  2026-10-17).** The route has no caller in the till app, and `listAvailableProducts` is off the sale
  path. `TillApi.listProducts` (`apps/till/src/api/client.ts`) is kept because the till's tests
  stub it; outside tests `listAvailableProducts` is called by that route and two dev scripts. Done
  when the route and `TillApi.listProducts` are gone and no till test stubs `listProducts`.

- **Two branches still read a held line that names no menu offer**, which only an order parked
  before B4 should have: `getHeldOrder` (`apps/server/src/working-order.ts`) and the till's retrieve
  (`liveByProduct` in `#onRetrieveOrder`). **Next action:** delete both, since no
  backwards-compatibility code is owed before production (CLAUDE.md §3), or say what keeps them.

- **Loose ends left by A491 (#1569).**
  - A till's automatic reload after a box update clears a notice its lock screen was showing, such
    as "Moved to another server. Enter your PIN." (`server.switched`, held only in the page's
    memory; read, not run).
  - A pressed Reload and the till's "which station?" question, two edges found by reading, not
    run: a hold that is refused and asks for a station again still reloads if Reload is pressed in
    that moment (nothing was saved yet), and a place waiting on that question holds a pressed
    Reload until someone touches the till.

- **Loose ends left by A526 (#1579).**
  - With the service closed, a wide till's menu area shows nothing, and the "Service area" picker
    and the "Keep … open later" button go with it. Seen once at 1280 wide. Read, not run: the
    retired renderer hid controls with its menu card. Recheck the observation on fixed Counter
    (`apps/till/src/screens/till-counter-screen.ts`); its controls and menu are separate now.
  - In Spanish at 390 wide, the counter's basket line showed no product name in two screenshots of
    the Collect step (light and dark): the row with quantity, price and Note is there, the name row
    above it is missing, not cut off. In English at 390, and in Spanish at 1280, the name shows.
    Seen once; cause not investigated.

### Printers, the print agent and receipts

_Formerly A3, A8 and B6; part of A9._ Detail: [backlog/printers.md](backlog/printers.md).

- **A754. The receipt's date and time on a line of their own (owner, 2026-10-16).** Today they
  share the order's row and wrap when it overflows; a longer table name or order number will
  overflow more. A mock-up for the owner first; it changes printed invoices, so the owner lands it.
  [Detail](backlog/printers.md#a754-the-receipts-date-and-time-on-a-line-of-their-own)

- **Show a failed automatic invoice copy to staff.** A recoverable email or office-printer
  reservation refusal commits the sale with no delivery row or paper fallback; the diagnostic
  is in the server log. Decide how the till should show that outcome and offer another copy.
  [Receipt-branch observation](backlog/printers.md#show-a-failed-automatic-invoice-copy-to-staff)

- **What the AppArmor profile (A129, #862; A134, #887) left open:** **`trust` is still refused.** **The setup page's HTML says nothing about Bluetooth availability** — only `/status.json` and the log do. [Detail](backlog/printers.md#what-the-apparmor-profile-a129-862-a134-887-left-open)

- **A sweep in flight keeps connecting after the discovery window closes** (189 of 253 connects on
  #313 started after expiry). Pass the deadline through `Host.scan`. The office-printer check and
  the check of addresses typed into the dashboard still run inside the poll, so the job pull waits
  for them (C117, #955).
  [Detail](backlog/printers.md#a-sweep-in-flight-keeps-connecting-after-the-discovery-window-closes)

- **Unpair can come back for a short while after a successful unpairing** — found in C103's review, read, not run. Clearing `pairedAt` when the agent reports a successful unpair, or reports the device unpaired, would end it; the owner was asked (questions.md, C103). [Detail](backlog/printers.md#unpair-can-come-back-for-a-short-while-after-a-successful-unpairing)

- **An agent compares the server's discovery deadline with its own clock** — found in C102, read, not run. An agent on another machine whose clock is out by minutes scans for the wrong span; one on the box shares its clock. [Detail](backlog/printers.md#an-agent-compares-the-servers-discovery-deadline-with-its-own-clock)

- Retry spacing is the agent's batch interval rather than a per-job backoff, so a flapping printer
  burns `MAX_DELIVERY_ATTEMPTS` at loop speed — needs a next-attempt column.

- **Cross-box print-agent TLS** — an agent trusts only its local box CA, so a mirror's agent cannot
  reach the primary; gates the mirror's print agent (_Afterwards_). The vouch slots into the same
  route later.

- **Cloud-poll transports** (Star CloudPRNT, Epson Server Direct Print) — a NAT'd printer with no
  agent. Low priority.

- **On-device agent** — a till hosting a print agent, the single-box venue's box-death printing path.
  Needs a native app; parked behind the go-native decision.

- **Measure one-job print pulls on the box** — A517 repeats the agent's inventory cycle per job.
  Physical throughput is unmeasured. [Detail](backlog/printers.md#measure-one-job-print-pulls-on-the-box)

- **Make an unreported drawer outcome explicit without repeating its pulse** — a lost claim or
  done report remains “printing”, with no resend or automatic expiry.
  [Detail](backlog/printers.md#make-an-unreported-drawer-outcome-explicit-without-repeating-its-pulse)

- **`runAgentOnce` (`packages/printing/src/runtime.ts`) has no production caller in the tree** — C70, #866. A refused report still rolls back its job claim when the caller's transaction rolls back, so that job can print again (measured 2026-09-29 with a scratch probe). [Detail](backlog/printers.md#runagentonce-packagesprintingsrcruntimets-has-no-production-caller-in-the-tree)

- **Waitron carries two QR encoders; consolidate on `qrcode-generator`** — Small. Switch the three
  server sites over and drop `qrcode`; hoist the receipt's hand-ported money/date/label formatters
  into `packages/shared` too (the paper receipt already drifts from the screen by an NBSP
  normalisation).
  [Detail](backlog/printers.md#waitron-carries-two-qr-encoders-consolidate-on-qrcode-generator)

- **Printer lists that still read as empty while loading or after a failed read** — left open by
  A428. Still open: the Printers screen's printers, agents and jobs tables say "No printers yet.",
  "No print agents yet." and "No print jobs yet." after a FAILED read, beside the screen's
  refresh-failed message (sibling tables pass `errorMessage`).
  [Detail](backlog/printers.md#printer-lists-that-still-read-as-empty-while-loading-or-after-a-failed-read)

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

- **Loose ends left by C107 (#974).** [Detail](backlog/printers.md#loose-ends-left-by-c107-974)
  - Whether a job of pictures still needs the print area (`GS L`/`GS W`) that receipts, category
    pages and the test page send is not measured.
  - At 203 dpi a line could hold 32 columns on 58 mm paper (384 ÷ 12) and 48 on 80 mm (576 ÷ 12);
    it keeps 30 and 42.
  - The 28-dot line cuts letters: by the generator's own report, 67 of its characters lose at least
    one dot that was half inside the letter, most of them accented capitals losing the top of the
    accent.
  - The preview reads at most 4 MiB of a job and shows at most 2,048 blocks, so a job of more than
    about 2,040 lines is cut short at any width.
  - What a printer narrower than 576 dots does with the part of the ruler beyond its head is not
    measured.

- **Loose ends left by #367.**
  - Follow-up (ruling C): the preview no longer shows the QR link as text for a raster receipt. A
    possible fix is to carry the link alongside the print job so the preview can still show it as
    text.
  - Deferred (ruling H): decide whether to warn when no legal QR dot size exists. Re-check the
    valid-link range with `apps/server/src/qr-link-range.test.ts` before changing the fallback.

- **Still counted by the printer's `printer.jobs_waiting` alert after A167 (#975)**, measured with
  throwaway cases and not pinned.
  [Detail](backlog/printers.md#still-counted-by-the-printers-printerjobs_waiting-alert-after-a167-975)

- _2026-10-01 (3c-3): a dish moved to another station leaves its ticket at the old station's
  printer counted by that printer's stuck alert in the same way, because nothing reprints there._

- **The virtual PDF printer**, and a `print_jobs` retention sweep — nothing deletes a job today.
  Finished jobs are to be kept one month (owner, 2026-10-14). [Detail](backlog/printers.md#the-virtual-pdf-printer)

- **Shared office-printer queues need physical qualification after A576.** From the shipped
  print-agent container, discover two queues on one computer, add both and print distinguishable
  pages to each. [Detail](backlog/printers.md#shared-office-printer-queues)

- **Office-printer detection is proven on one office printer only.** The owner's HP Color LaserJet
  MFP M181fw's real reply is a test fixture, and the live query marked it from a Mac on the owner's
  network. It has not run from the box's container, and no receipt printer that answers IPP has
  been captured, so "A4 or letter means office printer" is a heuristic with one data point.

- **A552. Invoices on the owner's office printer are unchecked with the committed code.** Owed on
  the HP Color LaserJet MFP M181fw: a long full invoice sent as PDF through the product, its QR
  measured with a ruler and scanned with a phone. Left open by A231q.
  [Detail](backlog/printers.md#a552-invoices-on-the-owners-office-printer-are-unchecked-with-the-committed-code)

- **A553. How long the box takes to draw one A4 raster page, and its peak memory, at 300 and
  600 dpi, are not measured.** The server draws each page (`renderInvoicePage`,
  `apps/server/src/page-print-api.ts`); it has not been timed on the box, in the built image. Left
  open by A231q.

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
  [Detail](backlog/printers.md#a405--printer-details-and-the-print-queue),
  [mockups](backlog/mockups/a405-printer-details/)

- **Loose ends left by A662 (#1803).**
  - Nothing at start-up checks that boot hands `operationDescriptionRequired` to the module routes.
    With Veri\*Factu always offering a default description, the Departments readiness list is empty
    either way, so `apps/server/src/boot.departments-readiness.test.ts` no longer sees that flag;
    only `packages/venue-service/src/routes.test.ts` covers "required, no default".

- **A `wt-dialog` (and so `wt-modal`) holding hinted fields is taller inside than it shows (found
  by A662; predates it).** Each `wt-input`/`wt-textarea` hint is positioned absolutely, and the
  dialog's scrolling `.body` is not its positioning parent, so the hint counts towards the native
  `<dialog>`'s scroll height. `.body { position: relative }` removed the excess in the probe.
  [Detail](backlog/printers.md#a-wt-dialog-holding-hinted-fields-is-taller-inside-than-it-shows)

- **Find a bill's pay offers no guests field** (left open by A663 Part 3b). A bill with no invoice
  yet stores the default guests count at that moment; one invoiced by an unpaid departure keeps the
  count stored then. The waiter cannot choose another number; the owner put the field on the
  payment screen only. Not decided.
  [Detail](backlog/printers.md#find-a-bills-pay-offers-no-guests-field)

- **Loose ends left by A663 Part 3b (#1827).**
  - The default guests count is worked out twice, kept equal by hand: on the till to fill the
    field (`defaultReceiptGuests`, `apps/till/src/state/receipt-guests.ts`) and on the server when
    no count is sent (`storableDefault` and `readReceiptGuests`, `apps/server/src/receipt-guests.ts`).
    A change to one that misses the other shows the waiter one number and stores another.
  - Leaving the payment screen after changing the count asks nothing, while a typed tip or cash
    amount does ask. The plan chose this; the owner has not said whether leaving should ask.
  - The number is `guests` on the wire and in the `sale_receipt_guests` column, but `guestCount` on
    the seat-a-table route, and Split a table uses `guests` for something else. Free to rename
    before go-live.
  - On the bill-paid-in-parts dialog, a count marked wrong stays marked after Back
    (`guestsAttempted` is cleared only on a new payment, `#startAgain`,
    `apps/till/src/widgets/bill-pay-dialog.ts`), and a server refusal naming `guests` shows only at
    the bottom: `refusalField` has no `guests` case.
  - `#onConfirmPayment` and `#onPayTab` (`apps/till/src/till-app.ts`) pick one of several call
    shapes only so older tests that pin the exact argument count keep passing; one call per path
    sends the same request.

- **A790. Choose a document and its permitted printer.** The owner's A661 Q1–Q6 answers
  and 2026-10-19 revision are recorded in the [design proposal](superpowers/specs/2026-10-19-a790-document-and-printer-choice-design.md),
  with [mock-ups](backlog/mockups/a790-document-and-printer-choice/README.md).
  **A is approved:** Receipt prints the same recorded full invoice compact with customer
  details through the receipt list; Invoice uses the invoice list, A4 or receipt paper.
  Neither issues another invoice. Apply A796's inline, collapsible receipt-printer selector
  at/after payment, with the last eligible choice preselected and no extra printer step;
  keep the named confirmation in that same form/action. Ask **B only** next: Harbour's
  device-free dashboard suggests Counter 1's current profile with an eligible-profile change
  (recommended), all sale-location printers, or a dedicated dashboard profile. No till
  memory is implied there. Remaining C/D choices, exact memory scope, persistence and the
  complete build are unapproved. The owner settled device scope for the handheld form;
  first-use/unavailable-equipment fallback and finer storage keys remain proposals.
  [Revised receipt-flow boards](backlog/mockups/a790-document-and-printer-choice/revision-2026-10-19/README.md)
  accompany the addendum; original boards remain historical where superseded.
  This revision changes docs only; source-map readings are historical and runtime-unverified.

- **Loose ends left by A661 (#1745).**
  - The till's payment-time options and a staged A4 choice resolve the device's invoice printer
    without the sale's location. Both call `resolveInvoicePrinter` with no `at`
    (`apps/server/src/till-api.ts`, `apps/server/src/working-order.ts`). From reading, a printer at
    another location is believed refused when the delivery is reserved; untested.
  - The print queue's Resend does not follow the till's rule for a full invoice's printer. A till
    refuses to resend an original a print request sent, when that printer is not the till's invoice
    printer (`receiptPrinterWithdrawn`, `apps/server/src/invoice-delivery-status.ts`). The
    dashboard's `POST /management-api/print-jobs/:id/resend` (`apps/server/src/print-api.ts`) does
    not apply that rule. Decide whether a manager's resend should.

- **Loose ends left by A663 Parts 1a, 1b and 2 (#1748, #1756, #1768).**
  - The till's on-screen receipt is a second copy of the layout (Part 1a). A663's changes do not
    reach it; bring it into line with the printed receipt.
    [Detail](backlog/printers.md#the-tills-on-screen-receipt-is-a-second-copy-of-the-layout)
  - On an A4 full invoice, a caption and its amount can split across pages (Part 2). A caption too
    long to share its line with the amount prints, then the amount moves to the next page when the
    page is full (`apps/server/src/invoice-page.ts:266-270`).
    [Detail](backlog/printers.md#on-an-a4-full-invoice-a-caption-and-its-amount-can-split-across-pages)
  - The A4 item table's header can sit alone at a page foot, and later pages repeat no header
    (Part 2). Each row checks only its own room (`apps/server/src/invoice-page.ts:248`).
    [Detail](backlog/printers.md#the-a4-item-tables-header-can-sit-alone-at-a-page-foot)
  - Quantities print with "." whatever the receipt language (Part 1a) («0.35 kg» on a Spanish
    receipt). [Detail](backlog/printers.md#quantities-print-with--whatever-the-receipt-language)
  - Equipment labels draw their double-size heading by hand (Part 1a).
    `apps/server/src/equipment-label.ts` scales a `drawTextBand` picture itself; `@waitron/printing`
    now draws double-size lines (`line(…, { double: true })`). Move the heading onto it and check
    its layout, which uses a different grid.
  - Receipt test tidy-ups (Part 1b). Six receipt test sites repeat the same filter that skips dashed
    rule lines; give them one shared helper beside `printedLines`
    (`apps/server/src/testing/decode-ticket.ts`). `receipt-preview-api.test.ts`'s `legal()` and
    `nif()` can be plain constants.

- Read-back gap: the printer editor cannot change a printer's connection type (`transport`),
  though the API's printer update accepts it (`PATCH /management-api/printers/:id`,
  `apps/server/src/print-api.ts`); nor does it send a USB or Bluetooth `localKey` or a cloud
  `pollId`. A261 step 8 retired the location print-mode and drawer-policy toggles.

- **One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still
  open:** No test pins what the two removed addresses, `/manage/receipt` and
  `/manage/location-settings`, open now. The paper-width dropdown names widths only, not printers,
  so two printers of one width at different resolutions cannot be told apart (owner's call). The
  offered widths need a fresh check when printers or devices change while the page stays open.
  [Detail](backlog/printers.md#one-receipts-settings-page-with-a-live-preview-c116-989-c120-1000-c121-996--still-open)

- **The Receipts preview redraws the whole receipt once per highlighted part** — left open by W111
  (#1261, the receipt's top block). W111 took the marks from 2 to 6, so one preview can draw the
  receipt up to 7 times, and the screen asks for a preview after each pause in typing. Not measured.
  [Detail](backlog/printers.md#the-receipts-preview-redraws-the-whole-receipt-once-per-highlighted-part)

- **Left open by #1261's review (W111):** database enforcement of logo retention remains open.
  Receipt contact length limits are still copied into the dashboard form. A493 removes the live
  venue-receipt transfer entry; the import follow-up about that entry is retired.
  [Detail](backlog/printers.md#left-open-by-1261s-review-not-acted-on-2026-10-05)

**Left open, for the owner, by C113 (#1014, one receipt language per location):**

- **A change is refused while an open order at the location holds a line**
  (`receipt.language_orders_open`; narrowed by C124, #1020, 2026-10-02, with core
  `0064_line_locale_triggers_text_only`). If a language is changed underneath an open bill by
  direct SQL, the bill's next split answers an unmapped 500 `server.internal`. [Detail](backlog/printers.md#a-change-is-refused-while-an-open-order-at-the-location-holds-a-line)

- After a change, a paid counter sale with one dish a station took and one it did not is not
  blocked, and its send-to-prep route (`/prep`) then answers 409 `ticket.already_fired`, as it
  did before the change, and leaves the order's lines unchanged. No till screen calls that
  route.

- The refusal's count of blocking orders is not shown on Venue settings' Defaults card: `codeMessage` fills
  in no values.

- The provisioning command (`waitron-provision`) can still store two languages, or one no pack
  offers; the first entry is the default receipt language. It does not hold Catalonia to Catalan:
  only the Receipts route and setup do.

- `cfg.invoiceLocales` (`apps/server/src/till-config.ts`) is no longer read outside tests (by
  grep) and can be retired.

- The till reads its fallback receipt language only when it
  starts (again after a server switch or an enrolment), so a change reaches those after a
  reload. The on-screen ticket follows each sale's own language.

- The dev and demo seed's English mode stores `en-GB`, which prints the Spanish words beside
  English dish names; Venue settings' Defaults card shows it as the saved language although it is not
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

- **A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN.**
  An agent told `not_approved` stops and needs resetting on its own setup page
  (`packages/print-agent/src/agent.ts`, the `not_approved` branch), so its request outlives a shut
  window instead. **Next action:** find a path, for example an agent that asks again on its own
  after a refusal, so agents follow the device rule.
  [Detail](backlog/printers.md#a-print-agent-cannot-be-discarded-when-the-join-window-shuts-a269-owner-2026-10-04--open)

- **Drop `printers.ticket_scope` at the next reset — OPEN (3d, W20).** — left open by the product
  folders work. Printing no longer reads the column. Dropping it rebuilds `printers`, so leave it
  until the venue reset that permits the rebuild.

- **Seen while looking at every modal at 1024px, not changed:** the printers screen's list of
  discovered printers keeps its details column capped (`min(28vw, 24dvh)`), so the details wrap
  while half the row stands empty; and the till's option picker puts each price far from its name.
  [Detail](backlog/printers.md#seen-while-looking-at-every-modal-at-1024px-not-changed)

- **The Printers screen's discovered-device rows' `data-test` names use the device alone** (W74d,
  #1242, left as it was): `discovered-row-`, `register-`, `pair-`, `forget-device-` and the rest,
  so a lookup by name finds the first row drawn for that device. Left open by W74 (deleting a
  category warns about exactly what will go, #1196).

- **Loose ends left by A331 batch 3b (#1415).**
  - A freshly added printer's wizard opens with a blue Save — the campaign runner's ruling of
    2026-10-08, for the owner to confirm.
  - The printer name dialog is titled "Add a printer" when its button says Enable — seen and not
    changed.

### Payments and card readers

_Formerly A6, and the old Track C's payments items; part of A9._ Detail: [backlog/payments.md](backlog/payments.md).

- **A742 — the guest types what they pay, and a tip (owner, 2026-10-15; on the backlog, NOT to be
  queued yet).** A flow where staff hand the device to the customer, who enters how much they want
  to pay of the bill and optionally adds a tip, then hands it back or pays on the reader. Builds on
  A739's payment window (An amount) and the bill payments design's tips. Not designed.

- **Two concurrent passes over `listAttempting` (`packages/payments/src/store.ts`; its one caller is
  the SumUp provider's `resolvePending`) do not both succeed**: #558's review measured
  `["fulfilled","payment.not_found"]`, so the second pass throws partway instead of skipping the
  rows the first resolved. The comment at `listAttempting` now says so. Found by #558 while pruning
  comments.

- **Loose ends left by A633.**
  - `packages/payments-stripe`'s `tenant-scoping.test.ts` is named for tenant scoping but guards
    that no source file opens a bare `.transaction(`.
  - `packages/payments-stripe`'s `vitest.config.ts` leaves `src/stripe-client.ts` out of coverage
    although the normal suite reaches it (CLAUDE.md §2).

- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe** — left behind by the
  tenant-column removal (#378, 2026-09-16). **Next action:** change it in the Stripe dashboard
  before any card payment is taken through a Stripe webhook.
  [Detail](backlog/payments.md#the-stripe-webhook-endpoint-still-has-to-be-repointed-by-hand-at-stripe)

- **Lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.** SumUp's
  older `refund` call still parses a 2xx or 4xx body as JSON
  (`packages/payments-sumup/src/sumup-client.ts`, `refund` through `call`), so a 404 answered with
  an HTML page throws `SyntaxError`. Its one caller is `reverseViaSumUp`; fold it into the neutral
  reversal primitive. Left open by A632.

- **A846. An orphaned card payment whose settled amount differs from ours is held, and never
  forgotten** (owner decision, 2026-10-17). Never refund it automatically while the amounts
  disagree, but keep its alert up and remind daily until a person resolves it, and have the sweep
  re-check closed periods for orphans still unresolved. Today every reconcile pass that still finds
  such an orphan asks for the same period to be swept again a day later, so its period is re-swept
  daily for as long as the amounts disagree (`resweepAfter`, `apps/server/src/reconcile-duty.ts`;
  the chain is pinned in `packages/scheduler/src/resweep.test.ts`). First check whether that already
  covers the "closed periods" half; if it does, the job is the daily reminder alone. Done when tests show the alert still raised and reminded on a later day, and a
  closed period's unresolved orphan found again by the sweep. **Checked 2026-10-18: the single
  case works, but a second held payment can stay out of every alert, a failed check ends the daily
  re-check for good, and nothing lets a person close a held payment.** Build waits for owner
  question Q44 (how a person closes one).
  [Detail](backlog/payments.md#a846-held-card-payments-what-the-check-found-and-what-to-build)

- **The reconciler's card reversal records only after the provider call, with a fresh key each time.** **Next
  action:** give the reconciler's reversal the same durable-attempt rule.
  Post-invoice returns use the durable `tender_refunds` path (A737 Part 2). The reversal remains
  open from the service, ordering and billing plan.
  [Detail](backlog/payments.md#the-card-refund-path-records-only-after-the-provider-call-with-a-fresh-key-each-time)

- **Loose ends left by B28's review (#1005), not acted on, under service Task 17 (#991).**
  - The reader pay's `tipOf` (`apps/server/src/till-sale.ts`) treats a `null` tip as no tip,
    against CLAUDE.md §3's rule that a default applies only when the field is absent; it predates
    B28, and paying a non-zero bill on the reader is believed to accept it the same way (read, not
    run). Next: a route case sending `tip: null` to `POST /api/pay`, then decide refuse or accept.
  - After a free sale settles on the reader, a stale card-attempt mark on the order is left in
    place; manual Pay is believed to leave it the same way (read, not run).

- **A placed order with no invoice is not checked against stored card payments when it is
  cancelled.** Its cancel sees a card running at the reader in this process, but not a stored
  payment its provider has not resolved, nor one captured and not yet filed; the cancel had no
  payment check at all before C126. (Its collect, card payment and unpaid departure do check both
  since A526.) Left open by C126 (cancelling an order whose invoice was issued credits it, #1030).

- **Task 4 (#832, every paper names all of a party's tables).** Not yet checked: the payment API's
  `/management-api/payments/stuck`, `/management-api/payments/bill-payments` and
  `/management-api/payments/bill-refunds` queries (`apps/server/src/payments-api.ts`), which read
  the same column. Left open by the table actions plan.
  [Detail](backlog/till.md#tables-parties-and-bills--the-tills-table-actions)

- **A875. Check two writes the bill payments design says a pending card refund refuses.** The
  design's §8 test 17 lists "a move" among the writes refused `bill.refund_in_progress`, and §5.2
  lists "transfer". Read, not run (A847's review, #1860): neither moving guests nor moving a bill
  appears to check for a pending refund, and the test covering test 17 makes no move; a transfer
  between bills appears to be refused earlier, `bill.payments_received`, because the refunded
  payment is still on the bill. Next: one route case each during a pending refund, then fix the
  design's wording, or the code if a move can change what a bill charges (ask the owner first).

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


- **Slice 2 — the handheld NFC/QR link: paying at the table from a handheld (A796).** Designed
  2026-10-19, waiting for the owner's answer to one question (ask which reader is in the waiter's
  hand on the first card of each bill, or before every card):
  [design](superpowers/specs/2026-10-19-a796-handheld-payments-design.md),
  [mockups](backlog/mockups/a796-handheld-payments/). Restoring `stripe_on_device` (Tap-to-Pay)
  remains open; it waits for the one-time native-app decision
  ([native app capabilities](superpowers/specs/2026-08-30-native-app-capabilities.md), N1/N2).
  [Detail](backlog/payments.md#slice-2--the-handheld-nfcqr-link)

- **The next identical bill payment can be answered with an unanswered one** (read, not run; found
  by A796's review). After a bill payment gets no answer, the till keeps its submission id keyed on
  the bill and the confirmed request (`submissionFor`, `apps/till/src/state/bill-payment.ts`), so
  the next identical payment on that bill from this phone reuses it. That covers a contribution of
  the same amount, the same units of the same line, or the same cash handed over. The server then
  replays the first payment (`beginBillPayment`, `apps/server/src/bill-payments.ts`): the second
  guest's payment is never recorded (a card is never asked), and the dialog shows the first payment's state ("Pago cobrado" once
  it was charged). An equal share escapes only when the number of people left is lowered. Fix:
  while a payment is unanswered, offer only the resend (A796 design, default 7). First write the
  failing till case: an unanswered contribution, then an identical one for the next guest.

- **Loose ends left by W102 (NFC and equipment labels).**
  - **Check NFC pick-up on the box's address.** On the OnePlus 13, grant NFC at
    `https://waitron.local` and try equipment stickers across till screens, sign-in, QR scanning
    and a return from locking the phone. Simulated readers do not verify the phone.
    [Detail](backlog/payments.md#check-nfc-pick-up-on-the-boxs-address)
  - **Check NFC sticker writing and locking on the box's address.** Write a spare sticker from
    Equipment label, read it on the till, test a moved-sticker retry and lock only a disposable
    one. Simulated writers do not verify the phone.
    [Detail](backlog/payments.md#check-nfc-sticker-writing-and-locking-on-the-boxs-address)
  - **Check equipment labels on a physical venue printer.** Print a portable printer's label on
    itself and a reader's label on another active printer, scan the paper and check the name and
    code. Confirm neither print opens the drawer. Paper output remains unverified.
    [Detail](backlog/payments.md#check-equipment-labels-on-a-physical-venue-printer)

- **The webhook `recordSale` hand-off** (Mode 3) and the reconcile remediation UI. The hand-off sits
  BEHIND the `AsyncPaymentProvider` seam and is therefore provider-neutral — building it against the
  Stripe Checkout adapter that already exists forecloses no cheaper provider later.

- **A guest paying from their own phone** (owner idea 2026-09-18, parked — the surface it needs does
  not exist). The waiter hands a greeted table a QR code standing for its newly opened tab; the
  diner scans it, reads the menu, orders, watches what has been served and what is still coming, and
  settles at the end. This is now the payment part of A508; the ordering surface is A508 and A509.
  [Detail](backlog/payments.md#a-guest-paying-from-their-own-phone)

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
  connected card reader in Demo mode, W38, #1172). A739 removes the pretend reader (owner,
  2026-10-15); delete this entry when it lands.

- **Check how real Stripe answers a malformed reader id, and one from another Stripe account** —
  left open by A519 (#1566). Whether test-mode Stripe answers those two cases the same way is
  unchecked; a sandbox case beside `checkout.sandbox.test.ts` would settle it.
  [Detail](backlog/payments.md#check-how-real-stripe-answers-a-malformed-reader-id-and-one-from-another-stripe-account)

- **A793 — tips: who a tip belongs to, how it is shared out, and what payroll gets** — NOT
  APPROVED: the owner (2026-10-18, on Q38): "Leave this for now. Back to the backlog. It needs a
  bigger brainstorm." Next: that brainstorm with the owner, before any build or further question.
  A first design is kept as input ([design](superpowers/specs/2026-10-18-a793-tips-design.md), pictures in
  [mockups/a793-tips/](backlog/mockups/a793-tips/), research in
  [compliance/research/2026-10-18-a793-tips.md](compliance/research/2026-10-18-a793-tips.md)); not
  built. A shared pot per business day split by hours clocked (kitchen included) or each person
  keeping their own, chosen on a new Tips tab in Venue settings that also replaces
  `WAITRON_TILL_TIPS`; cash tips handed out at the day's close (once a close counts the drawer,
  A239, and the asesor's L6(g) allows it), card tips paid with wages; a Tips page under Team by day
  and by pay period, frozen when a pay period closes (once the product has a step that closes one).
  The first design had six build slices (its §7), the first a fix (next entry). Replaces the old "Tip-collection UI" entry: cash and
  typed-card tips already arrived with bill payments (#956).

- **A whole-order card payment does not refuse a negative tip** (found by A793's design, read, not
  run). With tips on, a request that did not come from the till's own form (which refuses it) can
  carry `tip: "-5.00"`: `POST /api/pay` never checks `tip` (`apps/server/src/till-api.ts:1682-1737`)
  and `decimal()` accepts it (`packages/shared/src/money.ts:14-25`), so the reader would be asked for
  the bill less €5.00 and the tender would then fail its `tip_amount >= 0` check after the card was
  charged.
  A tip with more than two decimals is not checked either; the bill payment routes refuse both
  (`apps/server/src/bill-payments-api.ts:32`). Next: a route case sending `tip: "-5.00"`, then refuse
  it before the reader is asked. A793's slice 1. Full review (money).

- **A whole-order payment records the amount it expected, not the amount captured** (found by A793's
  design, read). A capture that differs from bill plus till tip is written as bill plus till tip
  (`apps/server/src/till-sale.ts:1568`, and `:1879` for an order already placed); only the recovery
  path reads the captured amount and calls the excess a tip. The only cause found is a reader whose
  own tip screen was switched on outside Waitron; other causes were not checked. Next: compare the captured amount at capture time, as the bill payment loop does
  (`payment.bill_capture_mismatch`).

- **Three small tip display gaps** (found by A793's design, read): the dashboard's order detail shows
  a bill payment's applied amount without its tip (`apps/dashboard/src/widgets/order-detail-dialog.ts:398`);
  the card slip's words are fixed Spanish (`apps/server/src/payment-slip.ts:55-59`); and the Spanish
  refund slip says "Propina" where the English says "Tip returned"
  (`apps/server/src/tender-refund-receipt.ts:79-92`).

- **A848. Show a clear message when the till pays, sends or moves an empty order.** `#onPayTab`
  (`apps/till/src/till-app.ts`) shows `sale.error` for any server code it does not name, which
  hides `sale.empty_basket`. On the till, try paying, sending and moving an empty order; where no
  clear message shows, add one in English and Spanish. Done when each of the three has been tried
  and shows a clear message.

- **The practice-mode simulator writes no `attempting` row**, so a switch during a practice card
  payment is never refused (read, not run). Left open by W97 (#1311), beside the owner's decision
  on in-flight writes ([till decisions](backlog/till.md#decisions-and-deliberate-limits)).

- **If the till never receives a bill reader payment's `device.profile_changed` answer**, its
  automatic resend under the same id gets the failed payment back and tells staff the card was
  declined: no card was charged, but the reason shown is wrong; the next tap starts a fresh
  payment (read, not run). Left open by W97 (#1311).

- **A provider that keeps sending data slowly, or a connection that is slow to open, can take
  longer** — a reader's status and the provider's available readers wait up to 250 seconds. Left
  open by A255 (#1145, lane A's W18c).
  [Detail](backlog/payments.md#a-provider-that-keeps-sending-data-slowly-or-a-connection-that-is-slow-to-open-can-take-longer)

- **The W48 test does not measure a real silent provider or the box's HTTP/1.1 connection limit.**
  Left open by A260 (several card readers' status reads at once can use up the browser's
  connections to the box; W18c #1145 and W48 #1162).
  [Detail](backlog/payments.md#the-w48-test-does-not-measure-a-real-silent-provider-or-the-boxs-http11-connection-limit)

- **A placed order with an unknown Stripe payment has no manager fallback.** Automatic checks
  retry it, but the stuck-payment manager route still takes only open orders
  (`apps/server/src/payments-api.ts`). The route restriction is read, not run here. Left open by A526.

- **`finalizeCapture`'s duplicate fallback can show a receipt for an order that is not settled**,
  while the card's charge stays on no sale (`apps/server/src/till-sale.ts`). Measured before A526 by
  the plan's reviewer, through an unpaid departure that A526 now refuses; no other way to reach it
  is known. Left open by A526.
  [Detail](backlog/payments.md#finalizecaptures-duplicate-fallback-can-show-a-receipt-for-an-order-that-is-not-settled)

- **An offline card payment that forwarding moved to `settled` with no sale no longer holds its
  placed order**: once no card payment of the order runs in this process, a collect is accepted
  (`ordersWithUnfiledPayment`, `apps/server/src/till-sale.ts`, counts no `settled` row). A526's
  review measured it with `FakePaymentProvider.forward`; of the adapters, only
  `StripeOnDeviceProvider`, which no app builds, settles forwarded rows. Left open by A526.

### Users, sign-in and the dashboard shell

_Formerly A7, and the dashboard entries in the opening part of the old Track A (before A1); part of A9._ Detail: [backlog/dashboard.md](backlog/dashboard.md).

- **Spacing for buttons grouped beside Cancel belongs in `wt-form-actions`.** The
  `[Cancel] [Delete…] … [Save]` row (design-system.md → Forms) has each dialog space its own group;
  move it into `packages/ui/src/components/wt-form-actions.ts`. Left open by A719 (#1838).

- **An off `wt-switch` is hard to see, worst in a dark dialog (seen in A757 slice 1's look,
  2026-10-19).** The off track is `--wt-color-border` (`packages/ui/src/components/wt-switch.ts:71`)
  and a dialog's background is `--wt-color-surface-raised` (`packages/ui/src/components/wt-dialog.ts:57`).
  Computed with the WCAG contrast formula from the values declared in
  `packages/ui-core/src/tokens/colors.css`: dark `#333945` on `#22262e` is 1.31:1 (1.47:1 on
  `--wt-color-surface`, `#191c22`); light `#d6d9e0` on `#ffffff` is 1.41:1. WCAG 2.1's non-text
  contrast criterion (1.4.11) asks 3:1. Not measured on a rendered page. Fix it in the primitive,
  not per screen.

- **A781. One shared panel-placement and arrow-key helper for the `wt-*` pop-up fields (left open by
  #1828).** `wt-colour-chooser` copies the panel placement (which since A783 also picks two or four
  columns) and the arrow-key handling that other `wt-*` components (`wt-combobox` among them)
  each carry their own copy of;
  `wt-language-chooser` and `wt-theme-chooser` already share theirs through
  `packages/ui/src/menu-popover.ts`. Move both into shared helpers in `packages/ui` and have every
  copy use them; each component's own tests and mutation score must hold.

- **The box's trust page and the favicon still follow the device's setting, not the Theme choice
  (left open by A681).** The trust page (`apps/server/src/trust-page.ts`, its logo in
  `trust-page-logo.ts`) is rendered by the server with no script, so it never reads the choice
  saved in the browser; it is the only server-rendered page under `apps/server/src` that reads the
  device's setting at all. The favicon (`packages/ui/brand/public/favicon.svg`) is drawn by the
  browser from the operating system's setting. Open.

- **Five tidy-ups A681's review left for later (#1842, 2026-10-17).** None is a defect; each
  reshapes working code. (1) Draw the dashboard logo as a token-coloured inline image, as setup's
  is, instead of swapping two images by `media`. (2) One shared "redraw when this changes" helper
  for the theme and the language. (3) Move more of the two choosers' repeated open and close steps
  into `packages/ui/src/menu-popover.ts`. (4) Rename the till's `language-chooser-styles.ts`, which
  now places the Theme menu too. (5) Handle a theme pick with a plain handler in each app instead
  of `ThemeChoiceController`'s `applies` option. Take them when next working in those files.

- **A653 — every long dashboard table scrolls the same way, with less above it (owner,
  2026-10-14; open).** Products keeps its toolbar and column headings in view and scrolls its rows
  inside the table's own box (`wt-data-table`'s `stickyHeader`, set by no other screen); a menu's
  Structure tab, and the other long tables, scroll the whole page instead. Make them consistent.
  The cost of Products' way is the height spent above the table, which on a phone leaves few rows;
  cut that down, phones first.
  [Detail](backlog/dashboard.md#a653--every-long-dashboard-table-scrolls-the-same-way-with-less-above-it),
  [screenshots](backlog/mockups/a653-table-scrolling/)

- **A657 — Cancel leaves without asking (owner, 2026-10-14; open).** A form's own Cancel, in a
  dialog or on a full page (the floor plan editor's Cancel link), drops the unsaved edits and goes
  without the "Discard changes?" question. Escape, a click outside, a dialog's ✕, and leaving a page
  any other way still ask. Reverses the written rule in design-system.md ("Protect an edited dialog
  before closing it"); change the rule in the same change.
  [Detail](backlog/dashboard.md#a657--cancel-leaves-without-asking)

- **A625. Check whether a row menu still wraps its two-word items after the window is resized to
  phone width (owner, 2026-10-17: keep as a check).** Seen on the Staff roles page (A585-1's look):
  after a desktop window was narrowed to 390 px, "Move up" and "Move down" broke onto two centred
  lines and the menu touched the screen's edge; loaded directly at 390 px it was one line per item,
  three times out of three. Believed to be the shared `wt-row-actions` popover, not that page; not
  yet reproduced on another screen. Done by one real-browser run of that resize on `main`: if the
  items no longer wrap, delete this entry; if they do, fix it. Screenshots kept outside the
  repository (lane C, `a585-1-shots/11a-…`, `11b-…`, `11c-…`).

- **A582. Help mode: a "?" in the top bar marks everything that has help (owner 2026-10-13)** —
  DESIGNED and approved 2026-10-18
  ([design](superpowers/specs/2026-10-18-a582-help-mode-design.md), pictures in
  [mockups/a582-help-mode/](backlog/mockups/a582-help-mode/)). Slice 1 of 5 landed (#1846: the
  help badge, the help switch's state and the help slots in `packages/ui`), and the shared half of
  slice 2 landed (#1848: a menu option with a help badge beside it, the help switch button, and
  help on table columns and tabs, in `packages/ui`); its dashboard half landed (#1851: the
  "?" in the banner, help on Products and in two menus, the five existing "?" shown only in help
  mode, and, by the owner's answer B to Q41, the language choices in the account menu when signed
  in). Slice 3 landed (#1871: the box serves the guides at `/help/<en|es>/<page>`, in English and
  Spanish, and three Products badges link to their sections). Next: slices 4–5, in the design's §8
  order. On the dashboard and on every device — tills, handhelds, and probably the
  kitchen screens and monitors — a circled "?" in the top bar switches help mode on and off; while
  on, a small circled "?" appears beside each thing on the page that has help, and clicking one shows
  the help or opens its page in the documentation. Nothing changes on the page while it is off.
  [Detail](backlog/dashboard.md#a582-help-mode-a--in-the-top-bar-marks-everything-that-has-help-owner-2026-10-13)

- **`wt-combobox` without a search box never exposes `aria-required`**, so a screen reader is not
  told a required dropdown is required. Found by A506-6's review: a probe showed `required` set gave
  `aria-required` on nothing, while a combobox with a search box set it on its input. Every screen
  using a required combobox without search is affected. One way to fix it is moving the trigger to the
  WAI-ARIA Authoring Practices' select-only combobox (`role="combobox"`, which can carry
  `aria-required`); A775 kept the button and fixed only its name. The Seasons window's Day and
  Month (A721) are among them.
  [Detail](backlog/dashboard.md#wt-combobox-without-a-search-box-never-exposes-aria-required)

- **In the Customise dialog, a released column row jumps into its slot instead of sliding.** The
  house rule for a dragged row (design-system.md, the `--wt-color-surface-lifted` paragraph) has it
  slide into its slot over `--wt-duration-move`; here every row lands at once (`#endColumnDrag`,
  `packages/ui/src/components/wt-data-table.ts`). Left open by A499.

- **Loose ends left by signing a dashboard tab out when its box has been reset (A485, #1545).**
  - After a box reset, the reset page's own banner still shows the old venue's name. By reading,
    not run: `#returnToLogin` (`apps/dashboard/src/dashboard-app.ts`) never clears the `venueName`
    that `getMe` set, and the locale read meant to replace it repeats the old name once made, since
    it is kept for the page's life (`#localesPromise`, `apps/dashboard/src/api/client.ts`).
  - A dashboard tab that never meets the box in setup mode gets plain sign-in, not the "box was
    reset" notice — for example one asleep through the reset and the new venue's setup; there is
    no venue identity to compare.
  - A sign-in screen already showing when a box reset is found may already have started its passkey
    autofill, and has started its Google settings read; the switch to the reset notice stops
    neither. By reading, not run: a tab already on sign-in (sent by the shared session deadline, or
    by a failed check on coming back into view) switches to the reset notice only when a later
    request is answered `node.reset`.

- **Loose ends left by A501 (#1552).**
  - A dashboard tab on the Backup screen learns of a box reset late. Setup mode answers only
    `/management-api/*` with `node.reset` (`mountSetup`, `apps/server/src/setup-api.ts`); the Backup
    screen and the content-languages read use `/api/...` paths, which setup mode answers with a 404
    with no code (or, without the built wizard, the placeholder page), so such a tab shows the reset
    notice only at its next management request. Measured by A501's Codex review against setup mode.
    Options: answer those dashboard `/api` paths with `node.reset` too (the boot test pins
    `/api/staff` answering the placeholder), or move the reads under `/management-api`.
  - `reportError`'s HTTP status is now unread. `apps/dashboard/src/session-signals.ts` no longer
    uses it, and the status hand-off in `packages/dashboard-kit/src/request.ts` was added only for
    the check A501 removed; a small cleanup across both packages.

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

- The dashboard's `es-ES` module default still needs the flip the till got in #170.

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

- **Loose ends left by W79 (#1186, the Menus list).**
  - `docs/developers/design-system.md` still says a list's Add action goes in a menu beside the
    table heading, while Menus, Staff and Units put a text Add button at the heading row's
    trailing edge; the doc only names the exceptions, and whether the rule itself changes is the
    owner's call.
  - The row-highlight tests focus only the row's own button, so nothing tests that a row
    highlights while another control in it, such as its Actions menu, has focus.

- **Loose ends left by A629 (#1684).**
  - The browser's "Open link in new tab" on a link marked `aria-disabled="true"` in a ⋮ menu
    (`wt-row-actions`) has not been tried. No screen marks one disabled yet; W88's busy-tree point
    would be the first.
  - A middle-click on a dashboard link marked `aria-disabled="true"` outside a ⋮ menu may still
    open it in a new tab — not tried. The dashboard cancels such a link in `#onAppLink`
    (`apps/dashboard/src/dashboard-app.ts`), which listens for `click` only; in A629's tests a
    middle-click on a ⋮ menu link opened a new page in Chromium until `auxclick` was cancelled
    too. Raised by A629's review.

- **Loose ends left by W83's review (#1193), not started.**
  - The table's Customise columns button is icon-only beside Filters and Select but has neither
    their look nor a tooltip.
  - The icon button and its tooltip are a stylesheet and a handler each caller wires by hand, not
    a `wt-icon-button` component — the Products table's Select is a native `<button>` because
    `wt-button` does not pass `aria-pressed` through, and the Structure tab's Reorder and Select
    toggles are hand-built icon buttons for the same reason.
  [Detail](backlog/catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)

- **A895. A dialog footer's long form message: the field it hides, its scroll cue and its name.**
  Left open by A849 (#1882), which moved a `wt-dialog` footer row's message into the footer and
  lets a message too long for the dialog scroll inside itself. Seen in its LOOK at 390×500 (scratch
  browser test): a 14-sentence message shrinks the body until the form's only field is cut off; at
  21 sentences the message scrolls, but the headless browser draws no scrollbar, so the only cue is
  a half-cut line, and its focus ring sits tight against the text. The message is a Tab stop while
  it overflows, but what a screen reader announces when it gets there was not checked. Messages
  are meant to be one sentence, so this needs a long message to show. **Next action:** decide
  whether the message should get a height cap (so the body keeps room for a field), padding inside
  its focus ring and an accessible name, then check them in a real browser.

- **A827. Check that row menus in plain `<table>`s stay on screen at 390 px (owner, 2026-10-17).**
  At 390 px the variant table's menus are held on screen through the product editor
  (`product-editor.test.ts`, "keeps every variant row's menu on screen at phone width"); the option
  list form's table and the product editor's attached extras/options table have 390 px cases that
  check where a row's menu sits, not that it stays on screen. Done when each of those two has a
  390 px case holding every row menu's right edge to the screen's.
  [Detail](backlog/dashboard.md#a827-check-that-row-menus-in-plain-tables-stay-on-screen-at-390-px)

- The reasons screen keeps its own copy of the role list and role names (C51 sorts its dropdowns by
  displayed name, with a separate seniority order for validation) and of the dashboard's
  placeholder-filling `fill` (`apps/dashboard/src/i18n/t.ts`). **Next action:** move both into
  `@waitron/dashboard-kit` if a third module screen needs them. Left open by service Task 1 (#706,
  adjustment reasons).

- **Override PIN limits (C89, #951), for the owner** — **Next action:** the owner decides whether to
  add the countdown and make the limit required. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- On the dashboard, the account menu (which since A582's slice 2b also holds the signed-in language
  choices) is a native popover in the top layer, so it paints over the alert pop-up (`.alert-toast` in
  `apps/dashboard/src/dashboard-app.ts`): where the two overlap, an alert arriving while the menu
  is open is hidden under it, and its countdown keeps running. Decide whether an arriving alert
  should close the menu. Left open by C133 (#1045, the till's tabs fit one screen), under service
  Task 16 (#981).
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

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

- **What C38 left as it was (a generated display name is the first given name and first surname,
  #827, owner decision 2026-09-28).** Left as they were, from #827's review: unlike the two staff
  forms, the profile screen keeps a taken-name message beside the display name when a first- or
  last-name change regenerates that name (`apps/dashboard/src/screens/profile-screen.ts` drops only
  the changed field's refusal); and the two staff forms turn the refusal into a field message
  inside the form, where other dashboard forms receive field messages from their parent screen.

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

- **Loose ends left by C47 (#838/#839/#840/#841).**
  - `wt-form-error-summary` is deleted once nothing uses it. Besides its own files and exports in
    `packages/ui-core` and `packages/ui`, the `packages/ui` workbench demo
    (`packages/ui/demo/main.ts`) and the consumer test page `packages/ui-core/test/consumer/main.ts`,
    which `packages/ui-core/test/package-consumer.test.mjs` loads, still use it.
  - The profile screen, opened with required details missing, marks those fields at once, before
    any press (two existing tests pin it), unlike every other form.
  - The form plumbing is hand-written per form: assembling the bottom message, waiting for the
    render and then calling `focusFirstInvalid`, and the state that remembers the first press and
    which refusals the person has since changed, in several different shapes.
    [Detail](backlog/dashboard.md#the-form-plumbing-is-hand-written-per-form)
  - The image picker's error message is not read to a screen reader. The Choose image button inside
    it carries `aria-invalid` and takes focus, so a screen reader hears "invalid" with no reason.
    Since A200 the product editor's photo button (`apps/dashboard/src/widgets/product-editor.ts`)
    has the same defect.
    [Detail](backlog/dashboard.md#the-image-pickers-error-message-is-not-read-to-a-screen-reader)
  - Found during C47 part 2 and not fixed: a refused save of a venue service setting that saves at
    once shows twice, beside the control and at the top of the panel (`render`,
    `packages/venue-service/src/dashboard/service-settings-panel.ts`), and the cases in
    `packages/venue-service/src/dashboard/service-settings-panel.test.ts` pin both.
  - Found during C47 part 2 and not fixed: `wt-switch` cannot be marked invalid — a server refusal
    of an adjustment reason's note-required switch would show its message but move focus nowhere.
    [Detail](backlog/dashboard.md#what-c47-part-2-found-and-did-not-fix)
  - Found during C47 part 2 and not fixed: a blue line along the top of a `wt-modal` editor's
    footer, in a screenshot after a refusal that names no field, which looks like the modal's
    scrolling body showing a focus ring — not traced, and not checked against `main`. A502 part 2
    saw the same line above the buttons of the floor plan editor's compact "Delete {name}?"
    question, opened by a click.

- **A switched-off `wt-switch` may be too faint to see** — seen in A639's screenshots of the Backups
  screen, not fixed: its track measured roughly 1.3 to 1 against the light page and 1.6 to 1 against
  the dark one, read from pixel colours in those screenshots, where WCAG 1.4.11 asks 3 to 1 for a
  control's boundary. Not measured from the component's tokens; `wt-switch` itself was not changed
  by A639 (last changed by W97, #1311).

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
  2026-10-08: take it from here when a lane has room):** **Remove the passkey name field**, and
  (owner, 2026-10-14) tidy the Profile → Security tab: Add passkey moves from the tab bar into the
  Passkeys row as a quiet button and stays there when passkeys are listed; the row gets its missing
  padding; the passkey's date says it is when it was added; the Add passkey dialog's "Save" becomes
  "Add"; and a message box seen cut off at the window's top-right edge is looked into.
  [Detail](backlog/dashboard.md#a403--sign-in-and-passkey-fixes-owner-2026-10-08-open-low-priority-not-queued--owner-2026-10-08-take-it-from-here-when-a-lane-has-room)

- **Review every permission: fewer, coarser, and consistently named** (owner, 2026-09-26). The
  review should propose the whole list: which permissions to merge, the names, and which role holds
  each, and then rename the call sites in one change. **Do it before the editable-roles item below**
  (owner, 2026-09-26). Since A494 (2026-10-11), `catalogue.manage` gates the catalogue,
  units and content languages; the "VAT class for new products" default is set under
  `venue.configure` (owner, 2026-10-16, A755).
  [Detail](backlog/dashboard.md#review-every-permission-fewer-coarser-and-consistently-named)

- **Roles are something an admin can add and edit; the four built-ins are only defaults** (owner
  decision 2026-09-12, restated 2026-09-28: "especially because I want roles to be definable by the
  customer"; design not written). Detail under [Roles the admin can
  edit](backlog/dashboard.md#roles-the-admin-can-edit-a7): the ladder question decides the schema.
  [Detail](backlog/dashboard.md#roles-are-something-an-admin-can-add-and-edit-the-four-built-ins-are-only-defaults)

- **Dropdowns sort by the label the person reads, with `Intl.Collator`; a list in a lifecycle order
  says so** (owner decision 2026-09-12). Still open: `wt-combobox` does not sort its options, and
  `compareLabels` (`packages/shared/src/compare-labels.ts`, used by `wt-data-table`) sorts in the
  default language of whatever runs it — in `wt-data-table`, the browser's; it should sort in the
  signed-in person's chosen language (owner, 2026-10-17).
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
  passwordless account; an operator screen for Google provider credentials (now part of A646);
  native passkey prompts on
  real hardware; a physical authenticator ceremony; live SMTP through `startServer`; whether an
  intermediary cache honours `Vary: Accept-Language`. #328's overlapping-dialog state was reached
  from code only; nobody has shown a real pointer can get there.

- **Three older dashboard screens name languages with their own code rather than
  `languageDisplayName` (`packages/shared`)** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.

- **Loose ends left by secret checks and the write lock (W1, #1117; #912's review).**
  - **Secret hashing still blocks the event loop** — left open by W1 (#1117). `hashSecret` derives
    with `scryptSync` (`packages/identity/src/secret-hash.ts`), so minting a token or setting a PIN
    or password stops the event loop. The `deriveKey` callers are listed under
    [The box](backlog/box.md#every-synchronous-derivekey-caller-still-blocks-the-event-loop-while-it-derives).
  - **`verifySecretAsync` could be renamed `verifySecret` (optional)** — left open by #912's review.
  [Detail](backlog/dashboard.md#secret-checks-and-the-write-lock-the-pin-manager-login-and-profile-checks-moved--done-w1-1117-two-blocking-derivations-and-one-stale-answer-window-remain-open)

- **A refused early dashboard payment authorization may become allowed before the PIN transaction —
  UNVERIFIED (A530 review).** `managerPinToCheck` (`apps/server/src/payments-api.ts`) returns no
  credential when its read refuses; `pinGated` then opens the transaction without a turn.
  [Detail](backlog/dashboard.md#a-refused-early-dashboard-payment-authorization-may-become-allowed-before-the-pin-transaction--unverified-a530-review)

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
  (`packages/ui-core/src/tokens/colors.css`). **Next action:** an owner colour call — darken the
  light theme's primary until it clears 4.5 to 1 as text, or rule that the token is never text on
  the page background and add a check that says so.
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

- **The dashboard's dark wordmark looked nearly black (A253 observation, 2026-10-09) — UNVERIFIED.**
  **Next action:** measure the browser's media preference and selected `<picture>` source against
  `data-wt-theme` in the live dashboard before deciding a fix.
  [Detail](backlog/dashboard.md#the-dashboards-dark-wordmark-looked-nearly-black-a253-observation-2026-10-09)

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
  `--wt-color-primary`, and a tenant theme cannot set it** — left open by A218 (#1082). The same
  holds for `--wt-color-primary-hover` and `--wt-color-danger-hover` (A306), and the disabled
  colours (A535), so a tenant or deployment that sets only `--wt-color-primary` or
  `--wt-color-danger` gets Waitron's default blue or red on a hovered or disabled primary or danger
  `wt-button`.
  [Detail](backlog/dashboard.md#--wt-color-primary-text-has-fixed-light-and-dark-values-that-do-not-follow---wt-color-primary-and-a-tenant-theme-cannot-set-it)

- **One earlier Spanish dark-theme 390 px demo probe reached its 12-second deadline before the
  bottom** — left open by A334 (#1416, held reorder drags scroll at the list edge). A 2026-10-09
  venue-service browser run also missed the Prep stations drag test's 1500 ms bound. The cause
  remains unverified.
  [Detail](backlog/dashboard.md#one-earlier-spanish-dark-theme-390-px-demo-probe-reached-its-12-second-deadline-before-the-bottom)

- **Service-status colour-field labels are clipped (found during W69, 2026-10-06) — OPEN.**
  The native status colour fields show an ellipsis instead of the full label in the inspected
  EN/ES service-status captures at 390 and 1280 px, both themes. Next action: reproduce in Venue
  settings → Tables and adjust the colour-field width using the shared field contract without
  changing status colour data.
  [Detail](backlog/dashboard.md#service-status-colour-field-labels-are-clipped-found-during-w69-2026-10-06)

- **A password manager filling the profile's current-password field** — the owner tried Chrome's
  password manager on 2026-10-08 and reported that it works well; other password managers are
  untried. Left open by A331 batch 3a (#1401).

- **Other purchases-screen and staff-screen tests still send made-up create and update
  events** (`create-purchase`, `update-purchase`, `create-person`, `save-person`)
  instead of pressing the form's button; they pass, but never prove the button works. Left open by
  A331 batch 3a (#1401).

- **A542. An open `wt-dialog` moved in the page stays open but is no longer modal** — OPEN, found
  by A539's mutation tests, not fixed. Out of modal, a long body grows past the screen
  (`packages/ui/src/components/wt-dialog.ts`). Seen in the purchase form's tests too: once put back
  with an edit, keyboard focus is outside the dialog, and Escape neither asks nor closes until
  focus is back on a field inside the dialog — left open by A397 part 1 (#1429), under A331 batch 5.
  [Detail](backlog/dashboard.md#a542-an-open-wt-dialog-moved-in-the-page-stays-open-but-is-no-longer-modal),
  [the purchase form's case](backlog/dashboard.md#once-put-back-with-an-edit-keyboard-focus-is-outside-the-dialog-and-escape-neither-asks-nor-closes)

- **In a text field inside a dialog, with the field's text selected, End and Home do not move the
  caret**, so typing replaces the whole text. Seen on the A721 branch in the Seasons window and the
  period dialog; a bare input and a bare dialog in the same Chromium behave normally. Cause not
  found; not tested on main.

- **On a hovered Products row in the dark theme, status and allergen badge borders appear to
  disappear into the row** — the earlier screenshot-only observation remains open. Contrast for those
  borders, a category row's maker link and the prep stations screen remains unmeasured. Left open by
  A319 (hover contrast after A306, #1347).

- **Text size after A179 (#988).** Open: page headings follow the Typography roles table in
  `docs/developers/design-system.md` (a page title at `--wt-font-size-xl`) only in part. **Phone
  check, the owner's to do (2026-10-01: "i'll test phones later on"):** Safari on iPhone is widely
  reported to zoom the page in when a field whose text is under 16px is focused — not yet tried
  here. [Detail](backlog/dashboard.md#text-size-after-a179-988)

- **Dragging a row (A180, #994 and #1003) — two things seen, left as they were.** A lifted row in a
  reorder list (`ReorderController`, `packages/ui/src/reorder-table.ts`) shows a faint
  line at each cell boundary, most visible in the dark theme, and a row lifted at the bottom of its
  list has its shadow cut off where the table ends.
  [Detail](backlog/dashboard.md#dragging-a-row-a180-994-and-1003--two-things-seen-left-as-they-were)

- **Two texts still use the old words.** A hint says "Create" (the Products screen's empty prompt,
  "Create a menu on the Menus screen…"), and the purchase dialog's edit heading reads "Edit
  purchase invoice" while its create heading is now "Add invoice". Left open by A450 (#1484).

- **Opening hours' create texts say "New …" and "+ …"** — `special.new` ("New special day") and
  `season.add` ("+ Season", the Seasons window's add button) in
  `packages/venue-service/src/dashboard/strings.ts`, against design-system.md → Wording's
  "Add …". The "+" label comes from the A506 seasons spec.
  Seen by A546's review; not changed there.

- **An update bar (dashboard or till) added while the tab is hidden is believed to show only its button until the tab
  is seen again**: `wt-banner` puts its message in two animation frames after it joins the page.
  Not run in a hidden tab. Left open by A491.

- **A541. A `wt-disclosure` reopened after an animated close snaps open with no animation** — OPEN,
  found by A539's mutation tests, not fixed. The close sets `body.hidden` behind Lit's back, so the
  reopen measures a hidden body and unhides it at once (`packages/ui/src/components/wt-disclosure.ts`).
  [Detail](backlog/dashboard.md#a541-a-wt-disclosure-reopened-after-an-animated-close-snaps-open-with-no-animation)

- **A543. During a flat tree search without `collapseDescendants`, `wt-data-table`'s `isExpanded()`
  answers false for a row the table draws open** (`aria-expanded="true"`) — OPEN, found by A539's
  mutation tests, not fixed. Outside a search it answers true for the same row
  (`packages/ui/src/components/wt-data-table.ts`).

- **A890. A tree `wt-data-table` draws a row's activator in its first column even when that column
  sets `activatesRow: false`** — OPEN, left by A813. A flat table now draws it in the first shown
  column that does not opt out; tree mode still draws it at `ci === 0`
  (`packages/ui/src/components/wt-data-table.ts`). No tree table sets the option on its first
  column today; what a click on that cell's blank space then does was not tested.

### Interface languages

_Formerly entries spread across the old sections, C125 among them; part of A9._ Detail: [backlog/languages.md](backlog/languages.md).

- **A887. The English guides say "parked order" where the till says "Hold" and "Held orders".**
  The Spanish guides and till agree on "aparcar". Decide one English word.
  [Detail](backlog/languages.md#a887-the-english-guides-say-parked-order-where-the-till-says-hold-and-held-orders)

- **A886. Dashboard wording: "Disabled product", "Menús", and two strings nothing reads.** The
  image library says "Disabled product" where the product screens say "Archived", the Spanish
  `product.refusal_menus`, `folders.delete_off_menus`, `routing.period_not_on_menus` and
  `venue.delete_item_staff_menus` say "menús" where the neighbouring strings say "cartas", and
  `product.disable_warning` and `product.disabled_badge` are unused.
  [Detail](backlog/languages.md#a886-dashboard-wording-disabled-product-menús-and-two-strings-nothing-reads)

- **The dashboard's locale lookup reads inherited properties** (A626 review, 2026-10-14).
  `pickLocale` in `packages/dashboard-kit/src/i18n.ts`, re-exported by the dashboard's
  `i18n/t.ts`, returns a function for `"constructor"` and an object for `"__proto__"`.
  **Next:** check own locale keys, test the English fallback and trace the callers.
  [Detail](backlog/languages.md#the-dashboards-locale-lookup-reads-inherited-properties)

- **The recovery page's Spanish (#650) has not been read by a native speaker.** Left open by SQLite
  slice 2 Task 3a (#566, one process per venue folder; #573; #608).

- **The file pickers' "Choose File / No file chosen" follow the browser's language**, not the
  chooser; the browser draws them. Left open by C42 (#837, the setup wizard in Spanish and
  English).

- **A830. Translate the till's certificate trust page (owner, 2026-10-17; left open by A379's
  source audit).** The page a device shows before it trusts the box's certificate
  (`trustInstructions`, `apps/till/src/main.ts`) is fixed English. Give it Spanish and the venue's
  other interface languages. The development device chooser stays English on purpose. Done when a
  test shows the page in Spanish.

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

**Left open, for the owner, by A477 (#1530, delete windows in the present tense):**

- **A831. The prep station and staff role delete windows take the device windows' words (owner,
  2026-10-17).** Both say "Trabajo que termina", "Settings removed" / "Ajustes eliminados" and a
  loading line in the conditional ("…would change…" / "…cambiaría…") (`prep.delete_*` in
  `packages/venue-service/src/dashboard/strings.ts`, `staffing.role.delete_*` in
  `packages/staffing/src/dashboard/strings.ts`). Use the device, printer and card reader windows'
  "Work that ends" / "Trabajo que finaliza", "Settings that are removed" / "Configuración que se
  elimina" and "Checking what changes…" / "Comprobando qué cambia…". Done when both windows' three
  lines read as the device window's do, in both languages.

- **Future-tense lines outside the delete windows were left alone**: the Remove-standby
  explanation (`servers.remove_explanation`, "It will be marked removed…"), the Spanish variant
  badge "Se archivará al guardar", and the Spanish PIN reset confirmation
  (`person.confirm_reset_pin`, "no podrá usar") whose English is present.

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
  its own line on 58 mm paper; on a simplified receipt it also drops below the order line on 80 mm
  when that line is long, as «Mesa 6 · Eskaera 41» is.

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

- **No test fails if `boot.ts` stops registering the dark pass screen alert** — left open by A451
  (#1486). `passScreenAlertSource` is tested on its own (`apps/server/src/station-outputs-down.test.ts`),
  but its registration in `apps/server/src/boot.ts` is checked by nothing that review found; the
  other sources registered beside it were not looked at.

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

- **A851. Staffing reads the venue's first business-day start, not the one in force (found by A788's
  design).** `currentCutover` (`packages/staffing/src/paint.ts`), the paint, route, rota and month
  reads use `clock.dayCutover`, the venue's first start; since dated start changes landed (#1563)
  a venue that changes its start sees staffing on the wrong boundary. Read the start in force for
  each date instead, with a test that changes the start and checks the painter and the Staffing
  month. Detail: A788's design, `docs/superpowers/specs/2026-10-18-a788-business-day-next-changeover-design.md`
  ("The staffing painters read the venue's first start").
- **A780. The staffing painters read holder names they never show (left open by #1828).** Both
  staff-role feeds (`staff-roles` and `painter-staff-roles`, `packages/staffing/src/dashboard/client.ts`)
  read `GET /management-api/staffing/staff-roles`, which always looks up every holder's name
  (`listStaffRolesWithHolderNames`, `packages/staffing/src/staff-roles.ts`). The painters use only
  each role's name, colour and holder ids. Give the painters a read without the names (a query
  parameter or a second route), keeping the Staff roles list's.

- **A763 point 9. The Staffing month's Monday "Rota for this week" link goes, and the Rota tab
  opens the week last picked (owner, 2026-10-16).** Waits for the second part of A724, which has not landed. Monday's box
  becomes the height of the others; the day box's Rota for this week states where that week's rota
  stands. A763's points 1–8 are built.
  [Detail](backlog/workforce.md#a763-point-9-the-staffing-months-monday-rota-for-this-week-link-goes),
  [mockup](backlog/mockups/a763-rota/06-staffing-month.png)

- **A link look for `wt-button` (left open by #1841).** The Rota's picker and open-slots menu draw
  "Show everyone" and "Another shift…" as underlined links by restyling a `wt-button` locally
  (`slot-picker.ts`, `open-slots-menu.ts`). A `link` variant on the shared button would replace both;
  it changes a shared primitive, so it needs its token-painting and a11y tests.

- **Staffing's day box: each area's staff roles and times.** The box lists each area's number; the
  mockup's role names and times ("Head chef ×1 16:00–01:30") need the month read to carry each
  block. Decision 13 of the [A720 plan](superpowers/plans/2026-10-15-a720-calendar-year-month.md),
  [mockup](backlog/mockups/a718-a727-calendar-and-stations/10-staffing-month.png).

- **Wages / labour cost (SP16)** — a per-person pay-rule set (hourly or fixed salary for N contracted
  hours, rate overrides by condition of the hour, paid non-worked states) turning recorded and
  scheduled hours into accrued-versus-pending money. Rates are editable data, never hardcoded convenio
  numbers; needs public holidays for every year it pays (today only 2026 exists), national,
  regional and local. Gated on the labour advisor; not fiscal.

- **Inspector remote access to working-time records.** Add authenticated read-only access when
  Cloud can reach the box. Until then, download the record on request.
  [Detail](backlog/workforce.md#inspector-access-to-working-time-records).

- **Have the labour advisor check working-time exports before go-live.** Confirm required fields,
  the final applicable text and the representatives' minimisation policy.
  [Detail](backlog/workforce.md#advisor-review-of-the-working-time-export).

- **Payroll export waits for the gestoría's import format.** Shift templates and availability also
  still need features over their existing tables.
  [Detail](backlog/workforce.md#payroll-export-and-unused-scheduling-tables).

- **Frozen-summary name collection needs a valid test case.** Check whether a supported closed
  snapshot can name someone only in its summary before testing the defensive name-collection path.
  [Detail](backlog/workforce.md#frozen-summary-name-collection).

- **Choose readable PDF flags for working-time exports.** Decide how `null`, `true` and `false`
  should read in each language while preserving CSV scalars.
  [Detail](backlog/workforce.md#pdf-boolean-and-empty-values).

- **Nothing in the product closes a pay period** (found by A793's design, read). The workforce
  module's `closePayPeriod` (`packages/workforce/src/pay-period-close.ts:76`) is called only by test
  files (among them the fixture `apps/server/test/attendance-export-fixture.ts:77`); no route,
  scheduled duty or screen calls it. A793's slice 6 (tips frozen with the pay period) waits for one. Next: decide
  with the owner who closes a period and when (a manager's button, or automatically once it is
  due), then build it.

- **Pay-period cadence changes need a rule after closure.** Changing monthly to weekly after
  January closes makes 1 February resolve to 26 January–2 February, which closure refuses
  for overlap. A future editor refuses changes after the first closed period until the owner
  approves a transition rule (owner, 2026-10-15); leave it in the backlog until then.
  [Receipt and next step](backlog/workforce.md#pay-period-changes-after-closure).

- **Manager Hours needs a live-removal draft check.** Deleting the guard that keeps the
  selected person while a proposal is open leaves both Hours suites green. Add a controlled
  summary-removal case that checks the retained subject and blocked draft.

- **Workforce period reads still load complete history.** Narrow them without losing late or
  cross-period corrections; retain the new latest-instant and person-scoped reads. A10-1’s
  four-year synthetic measurement and the remaining query paths are in
  [workforce detail](backlog/workforce.md#a10-period-read-cost).

- **Staffing paint in calendar delete confirmations.** Decide whether a shared deletion-impact
  seam should count staffing paint when you delete a season or special-day date. The approved
  A585 scope leaves that count out. [Detail](backlog/workforce.md#staffing-paint-in-calendar-delete-confirmations)

- **Loose ends left by A585-7 (#1766).** Each comes from A585-7's review.
  - Copy rota assignments in one read: `changeRotaWeek` reads an assignment per copied shift.
    Measure a large week under the venue write queue, then batch that read while preserving the
    shift-id map and rollback checks. Query cost is unmeasured.
  - Reuse the rota picker's baseline labour checks: `candidateWarnings` validates the unchanged
    week once per candidate on each redraw. Measure a large picker, then share that baseline across
    its candidates without sharing candidate-specific warnings. Cost unmeasured.
  - The dashboard live-query guard misses inline dependency lists: the review put an unknown name
    inside `client.ts`; `scripts/live-subscriptions.test.ts` stayed green because it reads
    `live-queries.ts` declarations. Add a guard that refuses inline lists and a failing control.

- **Rota warnings: pin the outer query's local-date boundaries.** The offset-aware in-week filter
  is covered, but replacing the unattached-shift query's local date with UTC leaves the warnings
  cases green. Add cases at the outer edges of its three-week window; see
  [workforce detail](backlog/workforce.md#rota-warning-query-boundaries).

- **Roster browser-entry guard: reject server-only re-exports.** It rejects a Node import but
  accepts `export … from "node:fs"`. Cover re-exports as well as imports; see
  [workforce detail](backlog/workforce.md#roster-browser-entry-re-exports).

- **A699. The Staffing month keeps its own copy of month stepping, and staffing its own date
  formatting.** Next: move `stepMonth`, the limits and the copies A763 added into browser-safe
  venue-service files and export them.
  [Detail](backlog/workforce.md#a699-the-staffing-month-keeps-its-own-copy-of-month-stepping-and-staffing-its-own-date-formatting)

- **A700. A failed Opening hours read also hides the Calendar's other views.** A module view draws
  only once the page's own model loads (`render` in
  `packages/venue-service/src/dashboard/opening-hours-screen.ts`), so a person who only wanted the
  Staffing view sees the switch and the Opening hours error instead (A585-3). Next: decide whether a
  module view draws without that model.

- **A701. Opening hours' month reads the holiday tables twice on a holiday-linked special day.**
  `readOpeningHoursMonth` (`packages/venue-service/src/opening-hours-calendar.ts`) reads `tenants`
  and `holiday_geographies` once in `readCalendarMonthPlan` and again in its own holiday read
  (A585-3's review; `locations` is already read once). Next: hand the plan's holiday facts to the
  second read.

- **A702. Opening hours' season chip is clipped on a season name that is one long word.** Measured
  on the A721 branch at 390 px on 2026-10-18: the page does not scroll sideways (scrollWidth 390 =
  innerWidth) and a name with spaces wraps, but one unbroken 46-letter word runs to x=402.9 and its
  chip is cut off (`packages/venue-service/src/dashboard/season-chips.ts`). Next: wrap the chip's
  text with `overflow-wrap: anywhere`.

- **At 390 px the staff role dialog's open colour panel covers its own Colour field.** Seen by
  A783's look on 2026-10-18 at 390 × 844: the panel, now eight rows of two, is 462 px tall, too tall
  to fit below the field, so it is moved up to top 374 (the window's height less its own and
  8 px), over the field at about 376–432. Picking a colour still works. The period, station and
  season choosers at 390 px still open below their field (`role-chooser-new-*-390*.png` and
  `role-chooser-edit-host-*-390*.png` in `~/waitron-campaign-b/a783-shots/`; `positionPopup` in
  `packages/ui/src/components/wt-colour-chooser.ts`). Left open by A783.

- **A colour chooser left open while its window narrows may hide the chosen colour.** Read from
  the code by A783's finish-branch re-read on 2026-10-18, not measured: open on the last colour in a
  wide window short enough that two columns would scroll but four do not, then narrow it until two
  columns are needed; the resize re-places the panel at the same scroll position and nothing scrolls
  the chosen tile into view (`positionPopup` in `packages/ui/src/components/wt-colour-chooser.ts`).
  Next: try it, and if it shows, keep the focused tile in view after the columns change. Left open
  by A783.

- **A644. Staffing slots stop at minute 1440 on a business day longer than a day.** When the
  changeover moves later between two days (02:00 one day, 04:00 the next), that business day runs 25
  hours, but `slotsForDay` (`packages/staffing/src/slots.ts`) ends every slot by minute 1440, so no
  block can ask for anyone in the last hour, while `placeShift` can place a shift there (#1686's
  review). Next: decide whether a block may run to the day's real end.

- **The Rota shift routes read a null or malformed JSON body as an empty object.**
  For no body, `{` and `null`, `POST …/rota/shifts` answered 400 with `field: "week"` and
  `PATCH …/rota/shifts/:shiftId` 404 `shift.not_found` for an unknown id, neither naming `body`
  (A750's probe, 2026-10-16). Next: swap `readJsonBody` for `readRawJsonBody`, as change-week did.

- **A707. On a phone, a paint grid's block menu or Copy to… chooser can cover the block it belongs to.**
  `placePopover` (`packages/venue-service/src/dashboard/paint-grid-parts.ts`) moves a menu that
  does not fit below its trigger up over it. The staffing grid's block editor opens above its
  block when it fits there and not below; with room on neither side it still covers the block, and
  at 390 px the wide editor can cover blocks in the next column (A761's look, 2026-10-17). Opening
  hours' block menu and the Copy to… chooser have no such placement. Next: place them above or
  beside the block instead.

- **A708. The special-day staffing painter draws every date on the location's baseline changeover,
  while each date's opening hours and staffing slots use that date's own.** So when a changeover
  change is scheduled, a block can be drawn longer than the slots it asks for. Needs a decision on
  how one grid shows dates with different changeovers. Left open by A585-4.
  [Detail](backlog/workforce.md#a708-special-day-staffing-on-a-date-with-its-own-changeover)

- **A710. Readable initials in short staffing blocks** — a later zoom/readability design remains
  open. Keep the whole-day overview without vertical scrolling; use the tooltip and block menu
  for a short block's full name (owner, 2026-10-16).
  [Detail](backlog/workforce.md#a710-readable-initials-in-short-staffing-blocks)

- **A711. The two staffing painters copy each other's lifecycle, and venue-service's painters'
  parts.** A shared base or controller, and more exports from `@waitron/venue-service/painter`,
  would remove the copies. Left open by A585-4.
  [Detail](backlog/workforce.md#a711-shared-staffing-painter-code)

- **A712. The staffing painters have no "Opening hours | Staffing" switch in their bar, and a date
  that follows the season does not show the season's blocks faintly** — not built, by A585-4's plan.
  Each ‹ › step and each close adds a browser history entry, because a Calendar view can only push
  an address, not replace one.

- **A586. Labour rules and hours balance per person** — named agreements, one per person's contract
  (today one `convenio_config` per location); a running total of hours clocked and rostered against
  hours due, annual leave counted, with the yearly overtime cap. After A585; build on the working-time record
  ([spec open point 6](superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md)).

- **A587. Availability** — "can't work Wednesdays", preferred days; the `availability` table exists
  unused. Shown in A585's picker and warnings. After A586.

- **A588. A solver drafts the rota** — fills A585's open slots from each person's staff roles, rules
  (A586), availability (A587) and contracted hours, for the manager to adjust. After A587.

### Purchasing, recipes, stock and reports

_Formerly entries spread across the old sections._ Detail: [backlog/back-office.md](backlog/back-office.md).

- **The recipe routes and the recipe screen are unreached** — found by #615 while pruning comments.
  Recipe authoring is gone from the dashboard, and nothing replaces it as a surface; the parked
  recipe depth work (nested sub-recipes, plate costing, stock depletion) assumes an authoring
  surface that no longer exists. Next action: the owner decides whether to delete `recipe-api.ts`,
  the screen and the client methods, or to remount the routes and route the screen; whoever
  reopens recipe depth decides first whether recipe authoring returns as its own surface.
  [Detail](backlog/back-office.md#the-recipe-routes-and-the-recipe-screen-are-unreached)

- **A supplier credit note cannot be entered through the dashboard** — OPEN, unqueued. A negative
  gross total on the purchase-invoice routes is a supplier credit note and is accepted and stored by
  design (owner ruling 2026-09-21; task N1). Nobody has decided whether the form should be relaxed
  or the credit note should become its own document type.
  [Detail](backlog/back-office.md#a-supplier-credit-note-cannot-be-entered-through-the-dashboard)

- **Loose ends left by service Task 12 (#923, adjustment reports).**
  - A weighed item cancelled in part can differ by a cent between the cancel's list value and what
    stays on the line, so a rate can be a cent's share off. **Next action:** none unless someone
    sees it matter.
  - With no day picked, a screen left open past the day's cutover moves to the new, empty day; the
    date inputs show it, nothing announces it. **Next action:** decide whether it should keep the
    day it opened on.

### The box: backups, upgrades and recovery

_Formerly B2, B3, B4, B5 and B7._ Detail: [backlog/box.md](backlog/box.md).

- **Migrating a box drops the change-feed triggers one statement at a time, outside a
  transaction.** `removeChangeFeed` (`packages/db/src/change-feed.ts`, called first by
  `applyMigrations`) drops each `waitron_change_*` trigger on its own. A product change in
  `packages/db`, so A751 (a test-only change) left it.
  [Detail](backlog/box.md#migrating-a-box-drops-the-change-feed-triggers-one-statement-at-a-time-outside-a-transaction)

- **A branch install fetches compose and support files before resolving the image commit.**
  A push between those operations could give them different source commits; inferred from
  `deploy/waitron.sh`'s call order, not reproduced. Pin file downloads to the resolved commit
  in a separate deployment change. A490 pins both image builds only.

- **Google Drive as an archive destination.** Not built. Left open by A538.

- **`S3FileStore`'s listing and batch delete repeat `S3ObjectStore`'s**
  (`packages/stream/src/s3-store.ts`) with different error codes, and only the file store's refuses
  a repeated key or bad size and counts `NoSuchKey` as deleted; share them, deciding whether the
  bucket stream takes those checks too. Left open by A538.

- **The Amazon S3 delete and archive rehearsal's open edges (A538-9).** Left open by #1668, in
  `apps/server/src/testing/` (`aws-request-recorder.ts`, `s3-delete-scenario.ts`,
  `s3-archive-scenario.ts`) and the runbook `docs/developers/aws-backup-rehearsal.md`.
  [Detail](backlog/box.md#the-amazon-s3-delete-and-archive-rehearsals-open-edges-a538-9)

- **The Amazon S3 pause rehearsal's open edges (A538-8).** Left open by #1658, in
  `apps/server/src/testing/aws-rehearsal.ts`, `testing/aws-pause-gate.ts` and
  `aws-stream-pause.aws-rehearsal.test.ts`.
  [Detail](backlog/box.md#the-amazon-s3-pause-rehearsals-open-edges-a538-8)

- **The Amazon S3 rehearsal runner's open edges (A538-7).** Left open by #1648, all in
  `apps/server/src/testing/aws-rehearsal.ts` and its runbook `docs/developers/aws-backup-rehearsal.md`.
  [Detail](backlog/box.md#the-amazon-s3-rehearsal-runners-open-edges-a538-7)

- **Loose ends left by the Amazon S3 rehearsal's cleanup and send check (A641, #1704).**
  - The rehearsal does not track the Litestream processes a restore starts
    (`packages/stream/src/restore.ts`), so neither its teardown nor its keeper can stop one still
    running.
  - When teardown fails to delete the bucket and then fails to write the ownership marker again,
    the cleanup command refuses (`ownership-unproven`); the runbook says to delete it by hand.
  - A keeper that cannot reach Amazon S3 when it cleans up after a killed run gives no cleanup
    command: it reports a bucket the journal says the run owned as of unknown ownership and
    deletes nothing (`apps/server/src/testing/aws-rehearsal-keeper.ts`).
  - A journal the keeper refuses leaves the run's scratch folder, so a box's `secrets.env` and
    `recovery-kit.txt` stay on disk until a person deletes them (`readJournalAt`). The refusal is
    by design; the folder it leaves is the open part.
  - A process whose start time could not be read when the rehearsal tracked it is neither stopped
    by the keeper nor listed as left behind — only a log note says so (the `startTime === null`
    branch). Decide whether it should be listed as left behind.
  - The send check's `record` mode is used by no run (`aws-send-gate.ts`): delete it, or document
    how it refreshes the scenarios' request lists.
  - The keeper and the cleanup command each read the ownership marker with their own rules
    (`aws-rehearsal-keeper.ts`, `cleanupFromReceipt` in `aws-rehearsal.ts`); share one reader.
  - The list of tests that need versitygw is kept in three places in `.github/workflows/ci.yml`,
    so each new such test edits all three; derive them from one list.

- **`backup.archive_settings_unusable` is worded only as an alert** (`alert-messages.ts`), not on
  the Backups screen. Left open by A538-4.

- **Under environment management a shown archive recovery pack goes stale only when the key
  changes.** The pack route answers no `revision` there, so a bucket changed in the environment
  leaves the shown pack in place (`#dropStalePack`, `apps/dashboard/src/screens/backup-screen.ts`).
  Left open by A538-5 and A538-6d.

- **Two small leftovers in the Backups destination form, reported by A639's review and not fixed
  there (#1695).** Neither was reproduced outside the reviewer's run.
  [Detail](backlog/box.md#two-small-leftovers-in-the-backups-destination-form-a639-1695)

- **The Backups screen's Spanish names the bucket copy two ways.** The bucket choice's option says
  "El bucket de la copia continua" (`backup.destination.choice_stream`), while the hints beside it
  and the rest of the screen say "la copia en el bucket". From A538-6 (#1642); seen in A639's
  screenshots, not changed there.

- **A recovery kit can carry a recovery key its own restore refuses.** `parseRecoveryKit`
  (`packages/stream/src/kit.ts`) refuses a recovery key holding a C0 control character or DEL, which
  the box's key rules (`checkedRecoveryKey`) accept, so a box with such a key hands out a kit whose
  restore calls it damaged.
  [Detail](backlog/box.md#a-recovery-kit-can-carry-a-recovery-key-its-own-restore-refuses)

- **A restore that fails while writing the secrets has already replaced the venue database.**
  `placeValidated` (`apps/server/src/restore.ts`) puts the database in place and runs the restore
  hooks before `restoreSecrets`, so a full disk or a write error there leaves the archive's
  database with the old box's secrets. Predates A538-5.
  [Detail](backlog/box.md#a-restore-that-fails-while-writing-the-secrets-has-already-replaced-the-venue-database)

- **A backup destination that fails to build leaves archives reported as on.** In
  `BackupSupervisor.reload()` (`apps/server/src/backup-supervisor.ts`) the venue handle is assigned
  before `buildBackupBackend` runs for each destination, so a throw there leaves `current().enabled`
  true with no sweep running. Reported by A538-4's second Codex review; the driver read the order
  but did not reproduce the throw. Build the backends before adopting the handle, or undo on failure.

- **The bucket copy's settings screen cannot repair a stored record that cannot be decrypted.**
  `GET /api/backup/stream` (`readStored`, called by `view`, in `apps/server/src/stream-api.ts`) tolerates only
  `server.credential_unusable`; `credentials.decrypt_failed`, `credentials.malformed_payload` and
  `credentials.key_version_unknown` fail the read (400 with the raw code), so the panel shows an
  error and no form, although the bucket copy's Save would replace the record. Treat all four the
  way `UNREADABLE_CREDENTIAL` (`apps/server/src/credentials.ts`) groups them. Predates A538-4; found
  by its review.

- **Nothing checks that the error codes in the dashboard's `backup_stop` word list are still real.**
  `apps/dashboard/src/i18n/alert-messages.ts` gives `backup.staging_space_low` and
  `recovery.state_incomplete` their own sentence on the `backup.run_stopped` alert; a renamed code
  would quietly fall back to "Contact support.". The printer word list has such a check
  (`scripts/a4-hold-code-copies.test.ts`). Left open by A595 (#1675).

- **No test covers the supervisor ignoring results from a backup run a reload replaced.**
  `backup-supervisor.ts` drops `onUploaded`/`onDestinationResult` reports once that run's
  controller is aborted; removing both checks left the supervisor suites green in A538-3's review,
  because a reload starts a fresh record only after the old run has finished. The checks matter for
  a status read that began before the reload, or one made after `stop()`; a test needs one of those
  shapes. Left open by A538-3.

- **Every backup status read builds a new client per destination**, a new S3 client for a bucket,
  and closes it once its listing settles, even while the running sweep holds live ones. This predates A538-3, which added
  `close()`; reusing the sweep's backends needs `close()` to wait for a status read in flight.

- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
  [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **Backup & restore — carry-forwards (B2)** — left open by the restore hook (SP-3d, #248) and the
  dashboard wizard (#295). Named carry-forwards: a stale-`.tmp` sweep; a working-backup boot
  success-path integration test; scope the flat `resolvers` map by module when a second `nonDbState`
  module lands; a `packArchive` pack-time entries bound; a manifest-shape coded refusal (it fails
  safe under GCM auth today); generalise archive entry routing off declared source ids when a second
  non-DB source lands. [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **When a nightly report job exists, the backup slot should fire after it** — left open by the "backups off or stale" reminder (#371).

- **A823. Check which cold-restore steps still lack an operator surface, then list only those
  (owner, 2026-10-17).** Promote Slice 4 named connection rebinding, an advertised origin and an
  authenticated entry, and nothing in the code shows which of them is still missing. Walk the
  restore steps in a test, then rewrite this entry to name only the real gaps, or delete it if
  none is missing.

- **Reconsider the backup container against off-the-shelf tools** (a brainstorm): `WBA1` plus
  `WBK1` is restorable only by Waitron code. Scheduled local archives stream through protected
  files; reconsider using a standard encryption and archive format.

- **B3. The bootable USB installer** — Runs `waitron.sh install` unattended. Open questions it owns: whether the stick carries the images so
  install needs no internet; unattended updates for a box we did not sell; AP-mode WiFi onboarding. Box
  image constraints under [Box image constraints (B3)](backlog/box.md#box-image-constraints-b3). Not started.

- **The box image carries the WireGuard link.** [Detail](backlog/box.md#box-image-constraints-b3)

- **Kiosk options, none built:** Chromium in the box image, now the owner's lean for every box (B3,
  2026-09-29), and, later, Fully Kiosk resale for dedicated tablets.
  [Detail](backlog/box.md#box-image-constraints-b3)

- **The box the customer buys probably doubles as a till, so the image ships a screen and a browser** — owner, 2026-09-29. A lean, not yet a decision. **Open:** whether the box's own screen enrols as a till like any other device or is treated differently because it is local, and what address it opens the till at. [Detail](backlog/box.md#the-box-the-customer-buys-probably-doubles-as-a-till-so-the-image-ships-a-screen-and-a-browser)

- **a local maintenance account on each box** — belongs with B3; a discussion record, not an approved spec. Its remote-support half is tracked in Cloud and not approved. [Detail](backlog/box.md#a-local-maintenance-account-on-each-box)

- **A799. Upgrade testing with rows an older product wrote — blocking before go-live.**
  [Design proposal](superpowers/specs/2026-10-19-a799-real-database-upgrade-testing-design.md)
  and [review boards](backlog/mockups/a799-real-database-upgrade-testing/README.md) await owner
  agreement. The build remains open: a supported post-A760 captured venue, a later image applying
  pending migrations, exact preservation and a separate new sale. Issued-F1 coverage must be
  resolved explicitly; an unpaid recipient-bearing order does not cover an issued invoice.
  [Detail](backlog/box.md#upgrade-testing--blocking-before-go-live-owner-2026-09-26)

- **Automatic upgrades that can be undone until the first order** — owner, 2026-10-02. It takes no backup first, and once the new image has migrated the database there is no way back — an older image then refuses to start with `provisioning.database_ahead` (`deploy/README.md`, "It can migrate the box's database one way"). The point of no return is the first order taken on the new version, not the restart: rolling back after that would lose the order. [Detail](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order)

- **Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check.** [Detail](backlog/box.md#every-migrating-path-but-boot-and-the-bucket-rebuild-runs-with-no-ahead-of-image-check)

- **What `waitron.sh install`'s self-refresh (C83, #890) left open:** No case in `scripts/waitron-sh.test.mjs` covers a script not run from a file, a link `readlink -f` cannot follow, a folder the script cannot enter, or a box with neither curl nor wget. [Detail](backlog/box.md#what-waitronsh-installs-self-refresh-c83-890-left-open)

- **What `waitron.sh --reset install` (#1122) left open:** a build or pull that fails still leaves the box's files changed, as a plain `install` always has. [Detail](backlog/box.md#what-waitronsh---reset-install-1122-left-open)

- **What showing the failed start's reason (#695) left:** [Detail](backlog/box.md#what-showing-the-failed-starts-reason-695-left)

- **The recovery spec** — a degraded-but-trading mode and the module-contract field it needs.

- **The recovery page's secret bound is a convention, not a guard.** #310 masks URL credentials on every log line — the connection-string shape and nothing else. [Detail](backlog/box.md#the-recovery-pages-secret-bound-is-a-convention-not-a-guard)

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

- **`resolveSafeEntryPath` (`apps/server/src/state-secrets.ts`) is unchanged, and nothing chmods the
  staging folder** — found by #658 while pruning comments. Still open, not fixed, by the owner's
  choice: `unpackBundleToDir`'s walk and file write go by path, so a folder inside the destination
  swapped for a symlink during the unpack is followed.
  [Detail](backlog/box.md#resolvesafeentrypath-appsserversrcstate-secretsts-is-unchanged-and-nothing-chmods-the-staging-folder)

- **`apps/server/src/errors.ts` still cites CLAUDE.md §5 for things §5 does not say** — found by
  #656 while pruning comments. No production caller sets `skipSecrets` any more, so whether the
  option should go is open.
  [Detail](backlog/box.md#appsserversrcerrorsts-still-cites-claudemd-5-for-things-5-does-not-say)

- **`apps/server/README.md` (near line 230, the `WAITRON_SKIP_RETRY_MS` row) says the sleep clamp
  can round a value "past" a bound, which it cannot** — found by #653 while pruning comments.
  [Detail](backlog/box.md#appsserverreadmemd-near-line-230-the-waitron_skip_retry_ms-row-says-the-sleep-clamp-can-round-a-value-past-a-bound-which-it-cannot)

- **The empty-venue-directory reason #561 deleted from `packages/provisioning` … is false there** —
  found by #561 while pruning comments. The same reason still stands in
  `packages/provisioning/README.md` and in `docs/developers/conventions-data.md` (the paragraph on
  `resolveVenueDir`, "an empty directory is the RELATIVE `venue.db`").
  [Detail](backlog/box.md#the-empty-venue-directory-reason-561-deleted-from-packagesprovisioning--is-false-there)

- **`packages/provisioning/README.md` also says only `ES-common` is implemented** — found by #561
  while pruning comments.
  [Detail](backlog/box.md#packagesprovisioningreadmemd-also-says-only-es-common-is-implemented)

- **`packages/provisioning` code found by #561 and not changed.** The coverage config leaves
  `src/bin.ts` out with no reason stated any more, which may hide code a test could reach.
  [Detail](backlog/box.md#packagesprovisioning-code-found-by-561-and-not-changed)

- **On a box that holds a key while backups are off because its venue failed to open**, an apply
  that reuses the held key writes, reloads, the venue fails to open again, and the route answers
  `backup.effective_mismatch` (read from the route, not run). Left open by SQLite slice 2 Task 2a
  (#557, a recovery key that does not need an archive destination).

- **A too-short recovery key's refusals do not link to the button they name**, and with archives
  on the one they name, "Change the recovery key", cannot finish, because showing the current key
  refuses a too-short one. Left open by SQLite slice 2
  Task 2a (#557, a recovery key that does not need an archive destination) and A538-6d.
  [Detail](backlog/box.md#a-too-short-recovery-key-the-refusals-do-not-link-to-the-button-they-name-and-change-the-recovery-key-cannot-finish)

- **A relative backup folder is accepted.** The Backups screen's hint asks for a full path, but
  the server resolves whatever it is given (`resolveArchiveChoice`, `apps/server/src/archive-settings.ts`),
  so `backups-relative` saved as a folder under the server's working directory (seen on the dev
  stack during A538-6's visual check). That line came in with #1628 (A538-4).

- **The Backups screen's bucket fields copy the bucket copy panel's.** The field table, the
  required checks and the reveal button exist in both `apps/dashboard/src/screens/backup-screen.ts`
  (`CUSTOM_FIELDS`) and `stream-settings-panel.ts` (`FIELDS`), and `normalisePrefix` in
  `backup-destination-model.ts` copies the stream package's (`packages/stream/src/names.ts`). Share
  them. Left open by A538-6.

- **At phone width the configuration export's passphrase labels overlap "Show password"** on the
  Backups screen (seen at 390 px during A538-6's visual check, both themes). I believe this predates
  A538-6: the export section came in with #296.

- **Loose ends left by SQLite slice 2 Task 2a (#557, a recovery key that does not need an archive
  destination).**
  - The status watcher does not retry its own failed mint (the mint is a POST, never passive
    session activity), so the screen then offers no key until it is reopened.
  - The edit-settings form can meet `backup.recovery_key_exists` when a rotate (from another tab
    or admin) lands after it fetched the key.

- **Loose ends left by SQLite slice 2 Task 3a (#566, one process per venue folder; #573; #608).**
  - From #608: the recovery level is read before `recovery.lock`, so the pre-boot count another
    start writes can still push a server restarting at that moment onto the recovery page.
  - From #573's review, the owner's call: only an unwrapped `provisioning.database_in_use` is
    recognised — a wrapped one, or the store's raw `VenueInUseError`, would still count (no path
    wraps them today).
  - From #608, no behaviour change decided: the watchdog appends its line to `waitron.log` without
    creating the log folder, so on a machine with no such folder that line is lost; only a store's
    `close()` waits for the watchdog thread to end, not a bare `release()`.
  - From #566's review: the migrator's lock and the venue lock use one technique in two copies,
    and the test helper that holds the lock from another process is copied into several test
    files.

- **Loose ends left by SQLite slice 2 Task 5 (#569, `@waitron/stream`).**
  - Which real providers other than Amazon S3 lack S3's multi-object delete, and what each
    answers, is not established; Amazon S3 answered batches of 1,000 and 5 keys with 200 and no
    per-key errors on 2026-10-14 ([receipts](receipts/a538/README.md), A538-10). A provider that
    refuses it with a status other than 501 fails the day's prune (`stream.prune_failed`).
    `probeBucket` deletes one object at a time, so it cannot reveal such a provider; having it
    delete its test object through `deleteMany` would.
  - Amazon S3 is the only real provider's bucket the package has run against (the 2026-10-14
    rehearsal, [receipts](receipts/a538/README.md), A538-10); the unit tests drive the real S3
    client over a scripted network, and the loop test drives it against versitygw.
  - Every synchronous `deriveKey` caller still blocks the event loop while it derives.
    [Detail](backlog/box.md#every-synchronous-derivekey-caller-still-blocks-the-event-loop-while-it-derives)

- **Loose ends left by SQLite slice 2 Task 6 (#590, the Litestream supervisor).**
  - A pointer write from a process that has since died, landing after the restart, can still make
    the box refuse itself, because a restarted process starts with an empty record. In both cases
    the owner's alert (`backup.stream_refused`) still says another box is writing.
    [Detail](backlog/box.md#a-pointer-write-from-a-process-that-has-since-died-landing-after-the-restart-can-still-make-the-box-refuse-itself)
  - The server's 8-second shutdown stops the stream last, after the Cloud snapshot loop, so on a
    large database Litestream may not finish its last upload (it is still told to stop and does
    not outlive the server).
  - `pnpm setup:litestream` skips the download when the installed binary already reports the
    pinned version, so the checksum protects fresh downloads only.

- **Loose ends left by SQLite slice 2 Task 7 (#619, how current the bucket copy is).**
  - A commit that changes no row but writes to the side file, such as a schema change or a pragma
    such as `user_version`, is not reported, so the lag can read low.
  - An update that writes the same value, straight after a schema-only commit, is still reported,
    although it adds nothing for the bucket (a test pins it).
  - The check that the side file changed was measured on the Mac's filesystem only, not the box's
    Linux one; a commit landing in the same file-time tick after a side-file restart is missed.
  - A sale whose write transaction began before the supervisor first subscribed after boot is not
    counted, so the lag reads low for it.
  - Whether Litestream uploads anything while the side file is unchanged is not measured.

- **Loose ends left by A549.**
  - While the bucket is away, Litestream's local level-0 folder grows with nothing measuring or
    limiting it (`.venue.db-litestream/ltx/0/`): 61 MB over 1,595 sales in about 60 s, with the
    stream pause test's sellers slowed to about CI's rate (an 80 ms wait before each sale) on the
    owner's Mac. A venue's real rate and the box's disk were not measured.
  - Whether the side file grows, and the pause fires, in a real network outage was not run. A549
    stopped the bucket server; with a refused or timed-out connection, Litestream's start-up check
    errors and drops its read transaction to retry (`db.go` v0.5.17, `init`).

- **Task 8a** (#627, the server side of the bucket-copy settings): the dead-process pointer write
  under Task 6 applies here too. Left open by SQLite slice 2.

- **When the key rename and the put-back both fail, the new certificate is left beside the old key**
  (the listener refuses the pair). Publishing the pair through one atomic switch (for example a
  directory swapped by a single rename) would remove this case. Left open by SQLite slice 2 Task 9a
  (#630, the first start after a restore).
  [Detail](backlog/box.md#when-the-key-rename-and-the-put-back-both-fail-the-new-certificate-is-left-beside-the-old-key)

- **Loose ends left by SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`).**
  - `pragma integrity_check` is one blocking statement, and the venue watchdog kills a process
    after 120 seconds without a timer turn. The review measured 6.0 s on a 1.36 GB database on
    NVMe; box storage has not been measured.
  - A copy with no `tenants` row reads an empty tax id, which neither the command line nor the
    setup wizard ever accepts as confirmed, so it cannot be restored; no dedicated error code
    names that case.
  - An interrupted bucket rebuild, archive check or archive download leaves its scratch folder —
    a full copy of the venue database, or the encrypted archive (`archive-download-`, inside
    `restore-staging`) — under the state folder; the next run makes a new one and does not remove
    it. Also left open by A538-5.
  - A `.venue.db-replaced-` folder left in the venue folder is removed by the box's next start
    (`clearReplacedDatabases`, A31) only from the container's entry: a server started any other
    way (the dev stack) does not.
  - Open question: the first start's pointer read and the bucket rebuild's calls (the command
    line's `--from-bucket` and the wizard's `/setup-api/restore-bucket`) use different limits (15
    seconds and 60 seconds) and report different codes (`restore.pointer_unreadable` and
    `backup.stream_request_failed`). The code does not say why they differ.

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
  `packages/stream/src/s3-client.ts`).
  [Detail](backlog/box.md#the-bucket-clients-limits-a44-676--what-is-still-open)

- **The settings screen's Test and Save wait on the bucket with no time limit and no cancel
  signal** (`probeBucket` in `apps/server/src/boot.ts`, reached from
  `apps/server/src/stream-api.ts`), so a bucket that sends headers and then stalls holds that
  request open, though before any backup turn is taken. Left open by A538-1.

- **Loose ends left by #668, #686, A57, A60 and #723 (the pause test and the bucket's error
  reports).**
  - The wizard route answers `backup.stream_name_invalid` 400, where other bucket failures answer
    502 — the status table in `apps/server/src/setup-api.ts` maps the code as one, and the same
    code also covers a bad value in the recovery kit, where 400 is right.
  - A batch delete's `backup.stream_request_failed` still carries the file's name as the bucket
    listed it in `key` (the `deleteMany` refusal in `packages/stream/src/s3-store.ts`); that the
    prune logger drops it is a review seat's reading and one run, not a guard.
  - The status and `errorName` on the stream's log lines other than the pause check's 403 were
    shown by reading, by the store's scripted HTTP answers and by the supervisor's injected
    errors, not against a real bucket. Amazon S3's 403 to the pause check was logged with
    `backup.stream_request_failed`, 403 and `AccessDenied` (A538-10).
    [Detail](backlog/box.md#the-status-and-errorname-on-the-streams-log-lines-other-than-the-pause-checks-403-were-shown-by-reading)

- **A venue preparing to go live sends real email through SMTP (owner 2026-10-03) — OPEN.** "Later
  prepare should use a real SMTP server": a prepare venue would send invitations and password resets
  through SMTP instead of capturing them on the box, and the top bar's inbox link (A227) would become
  demo-only again. Not built.
  [Detail](backlog/box.md#a-venue-preparing-to-go-live-sends-real-email-through-smtp-owner-2026-10-03--open)

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
  descriptions of code that exists today. Open, among them: a cut-off primary keeps streaming, into
  its own copy (owner, 2026-09-24); a standby checks a promotion against the primary's key (owner,
  2026-09-26); and
  [provider cancellation ownership](backlog/payments.md#decisions-and-deliberate-limits) before
  enabling a second venue node (A764).
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

**Cloud integration and SQLite work.**

- **Loose ends left by the Cloud connection integration (2026-09-24; #638, #808).**
  - Customer remote setup UI and production deployment remain open.
  - Shutdown waits for an in-progress local database copy or encryption step. Next: measure that
    shutdown latency, real venue uplink budgets and spool disk use, and stream archive assembly
    beyond its current in-memory 512 MiB format limit. Cloud documentation:
    `docs/authenticated-captures.md` in waitron-cloud.
  - After a Cloud replacement (#638), installing the new tunnel and TLS certificate remains an
    operator step. Continuous complete-server recovery, planned final-write handover and production
    recovery remain open. Cloud owns route placement and fencing in its backlog.
  - A stop made while `cloud-replacement.json` is unreadable is not recorded in it. Owner to choose:
    refuse Stop access while the replacement file is unreadable, or record the stop somewhere that
    survives the repair.
    [Detail](backlog/replication-cloud.md#a-stop-made-while-cloud-replacementjson-is-unreadable-is-not-recorded-in-it)
  - The Litestream stream's sealed-state restore and activation still need integration with Cloud
    storage and owner recovery. Connected does not mean those services are configured. Cloud service
    ownership stays in the Cloud backlog; this repository owns its adapter, screen and node-side
    behavior. Public hosting, ingress controls and Cloud audit/retention remain deployment work.

- **Four Cloud reply and state readers accept a one-item list where they want text.** Each turns
  the field into text before checking it, so `["ready"]` passes as `"ready"`:
  `apps/server/src/cloud-client.ts` (the pairing reply's and saved view's `state`),
  `cloud-recovery.ts` (the saved recovery `phase`, and Cloud's `result.state`) and
  `cloud-replacement.ts` (Cloud's `state`). A689's first PR fixed the same pattern in
  `cloud-installation.ts` and `cloud-translation.ts`; these four predate it. Found by its review
  (2026-10-15), not measured against a real Cloud.

- **The signing and size-capped reading of a request to Cloud is repeated across the
  `apps/server/src/cloud-*.ts` files.** One shared helper would serve them all; left out of #1729
  as a refactor larger than that PR (its simplify review, 2026-10-15).

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

- **Loose ends left by the SQLite failover-loop prototype gate (#425; receipts in
  [the results note](research/2026-09-16-sqlite-failover-prototype.md)).**
  - **Validate every supported object store.** Topology §12.2's real-store gate remains open; the
    conditional-write promotion tie-break must be demonstrated on each target (risk 11). Waitron
    Cloud's production store still needs its own run.
    [Detail](backlog/replication-cloud.md#validate-every-supported-object-store)
  - The store pointer and a new generation are exercised for a rebuild, not for a promotion. A
    promoted node's generation, and Cloud's recovery orchestration (tracked in the
    [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)), remain;
    settle the Waitron ↔ Waitron Cloud contract before assigning them.
  - 250 sales a day is still an assumption nothing in this repository measures, so the days-per-GiB
    figure rescales but does not hold.
  - Three scenarios have no mutation receipts (S1, S6, `smoke`), two branches of the litestream
    wrapper are driven by no scenario, and the runner's own `main()` is undriven — a later task
    should pin them or delete them.

- **Task 1a** (#548, each machine's own rows keyed by its node id). Deny's delete is the one
  join-request node filter no test fails without (the `requirePending` read before it already
  refuses another node's row); and the run-it review did not reach three claims within its budget —
  holders torn by a concurrent promotion, credential sealing, and scheduler takeover. Left open by
  SQLite slice 2.

- **Loose ends left by SQLite slice 2 Task 9a (#630, the first start after a restore).**
  - A node row holding no endorsement still signs `endorsements: []`, and no first-start case
    asserts it.
  - A comment claims more than the code keeps: `retireSelf`'s header (`apps/server/src/retire.ts`)
    says a signing failure "leaves the node exactly as it was". Signing empties pending
    `change_log` rows (measured by #655's Codex seat), so they are not strictly untouched; no case
    losing a real one is known. Narrow it the next time the file is edited.
  - A restored box whose cloud peer does not answer during its first start signs the next term and
    removes the marker; a fencing document the peer serves later at that same term reads as not
    newer, so the box is never fenced (reproduced with a temporary two-boot case in
    `apps/server/src/boot.reconcile.test.ts`). Recorded, not redesigned.
    [Detail](backlog/replication-cloud.md#a-restored-box-whose-cloud-peer-does-not-answer-during-its-first-start-signs-the-next-term-and-removes-the-marker)
  - The pointer's term is taken without checking its signature, as the supervisor already does, so
    whoever can write the bucket can push a restored box's term up (never down).
  - A marker left on a fenced box survives `waitron-rejoin`: A836 below.
  - A sell-only local secondary that is not fenced runs the first start and signs the next term.
  - The restored membership row's check (`assertRestoredMembershipValid`, #678) trusts the keys the
    restored copy holds.
    [Detail](backlog/replication-cloud.md#the-restored-membership-rows-check-assertrestoredmembershipvalid-678-trusts-the-keys-the-restored-copy-holds)
  - Only the start that finishes a restore checks the row's signature. A mirror or fenced start
    checks only that it can be read and is shaped as a document (A53); a start still finishing an
    adoption checks neither.
    [Detail](backlog/replication-cloud.md#only-the-start-that-finishes-a-restore-checks-the-rows-signature)
  - On a start with NO restore marker, text that is not JSON or a machine list that is not a list
    fails with the generic text. Whether to give it a curated code is open.
    [Detail](backlog/replication-cloud.md#on-a-start-with-no-restore-marker-text-that-is-not-json-or-a-machine-list-that-is-not-a-list-fails-with-the-generic-text)
  - A mirror that deferred its first start and is then promoted without a restart
    (`promoteMirrorToPrimary`) keeps the bucket copy held, reading off with the reason
    `first_start_pending` and raising no alert, until the box next starts. From reading, not a run.

- **A836. `waitron-rejoin` clears a restore marker left on a fenced box (owner, 2026-10-17).**
  Today the rejoin wipes the database and removes only `trading.env` from the state folder
  (`apps/server/src/rejoin-command.ts`), so the restored first start runs whenever that box next
  starts trading unfenced and not as a mirror. Make the rejoin clear the marker too. Done when a
  test shows a rejoined box does not run the restored first start. Left open by SQLite slice 2
  Task 9a (#630).

- **If a later slice moves `local` tables into `node.db`** (slice 2's design reserved it for slice
  5), that slice decides again how the drain crosses the two files: SQLite refuses a trigger body
  that writes another attached database, so either `change_log` is reclassified to the file its
  writers live on, or the triggers stop writing it directly and something above them does (P3). Left
  open by SQLite slice 1 (#490 and the preparation tasks).

- **A promoting standby may list itself with an empty `contactUrl`, so no till is told to dial it.**
  Nothing the #600 review could find copies `node_membership` from the primary to a standby. A
  standby whose own held membership list omits it takes the fallback in `nextStandings`
  (`packages/membership/src/standings.ts`), which appends it with an empty `contactUrl`, and
  `routableServers` (`packages/membership/src/fence.ts`) then drops it. Found by reading, not run.
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

### CI, tests and developer tooling

- **A late move or second finger can overtake the gesture hold timer.** A delayed move is
  treated as a pan, and a delayed second finger misses hold cancellation. Disposable probes
  reproduce both on unchanged main `d5230d32d` and A891's candidate. Extend hold recognition
  to those paths with their own tests; native-device reproduction remains unverified.
  [Detail](developers/testing-guide.md#a-held-press-can-reach-pointer-up-before-its-hold-timer-runs).

- **A891: retain input and timer timing if the missing product-information window recurs.**
  A busy-renderer probe reproduces the original CI symptom, and the gesture now recognizes a
  held release before its overdue timer. Main run `39180066136` retained no such trace, so its
  exact cause remains unverified. On recurrence, keep pointer timestamps, hold-callback timing,
  selection count and the screenshot before retrying.
  [Reproduction](developers/testing-guide.md#a-held-press-can-reach-pointer-up-before-its-hold-timer-runs).

- **`apps/server/src/invoice-pdf.test.ts` took 162 s on one CI run**, the slowest server file by
  far (run 39068745456; the next was 99 s), so it sets a floor under whichever shard holds it.
  Profile it and split it or find its cost, as A528 did for `boot.test.ts`. Left open by A801.
  [Receipt](developers/ci-and-gates.md#runners-come-in-two-speeds-and-the-busiest-shard-is-the-one-that-crosses-4-minutes)

- **Other server test files still hash fixed PINs and passwords on every test.** A801 moved the
  shared fixtures under `apps/server/src/testing/` and the set-up of five heavy test files onto
  `fixturePinHash`/`fixturePasswordHash` (`apps/server/src/testing/known-secret-hashes.ts`); other
  test files and helpers still call `hashPin`/`hashPassword` directly (`rg -l
  'hashPin\(|hashPassword\(' apps/server -g '*.test.ts' -g '**/testing/**'`), among them the
  `attendance-*` suites, left alone while lane G's A773-1 was editing them, and the two venue
  helpers under `apps/server/scripts/` (`testing/venue.ts`, `demo-seed/testing/provision-venue.ts`).
  Move the set-up ones over; leave any test that is about hashing. Left open by A801.

- **Tests copy the dashboard shell's link handler instead of calling it.** `#onAppLink`
  (`apps/dashboard/src/dashboard-app.ts`) has hand-made copies in tests, one of them
  `packages/venue-service/src/testing/shell-link-capture.ts` (A719); a change to the real handler
  is not seen by them. Export one function from `@waitron/ui` that both the shell and the tests
  use. Left open by A719 (#1838).

- **Retain failure screenshots for long browser test names.** A failed waiting-list refresh case
  in `apps/till/src/till-app.test.ts` logged `locator.screenshot: ENAMETOOLONG` during A743's
  fixture checks. Bound the generated screenshot filename and keep the complete test name in
  its metadata; verify with a deliberately failing case whose generated name is long.

- **A pnpm setup retry does not identify which command failed.** A746 removes the test fixture's
  blanket one-second version deadline, with a controlled slow-check regression. The original
  intermittent A737 retry was not reproduced, and its first failure's cause remains unknown.
  On recurrence, retain separate install and version-check statuses before assigning a cause.
  [Detail](backlog/ci.md#identify-which-pnpm-setup-command-failed).

- **At a load average near 60, five more root guard files fail on time (left open by A751).**
  With three root projects and eight spinning shell loops on the 18-core Mac, A751's branch passed
  the four files it fixed and still failed `fiscal-allocation-migration`, `guarded-teardowns`,
  `menu-sections-upgrade`, `mutation-shard` and `pre-push`.
  [Detail](backlog/ci.md#at-a-load-average-near-60-more-root-guard-files-fail-on-time).

- **The installer's timeout-diagnostic test expired before reaching Docker.** During A668-5's
  normal push, the 700 ms case retained self-update curl/copy calls but no Docker call, and its
  existing `/docker/` assertion failed. The menu-upgrade populated case also exceeded 30 seconds.
  Both files then passed all 105 cases in isolation, without a code or test change; no repair is
  claimed. Investigate the full-suite workload and the diagnostic's preparation phase.
  A further full hook failed the mutation-shard fixture's 30-second bound and two step-watch
  cases (a 212 ms phase against a 100 ms limit, then a missing diagnostic match). A770 (#1816)
  reproduced paused-thread failures and changed those watchdog test budgets; A668-5 resumed on
  that main commit. The installer, menu-upgrade and mutation-fixture timing still need investigation.
  [Receipt](backlog/ci.md#a668-5-normal-push-recurrence-2026-10-16).

- **`scripts/spawn-timeout-budget.test.ts` never judges `scripts/ci-workflow.test.mjs` or
  `scripts/migration-upgrade.test.ts`.** Its `budgets()` returns `unreadable: true` for both, on
  `main` (`b81f1481c`) as on A751's branch, so a wait in either that outgrows its bound passes it.
  Measured by calling `budgets()` on each file's text; which construct it cannot resolve was not
  traced.

- **A624. The upgrade walk cannot step a new set whose first migration names another set's later
  table.** `scripts/migration-upgrade.test.ts` applies every set's first migration together at its
  first step, so a set added now whose first migration has a foreign key to a table another set
  created later fails there. Next: teach the walk to apply a first migration dated after its floor
  at its own date (a change to how the guard walks, so the owner decides).
  [Detail](backlog/ci.md#a624-the-upgrade-walk-cannot-step-a-new-set-whose-first-migration-names-another-sets-later-table)

- **The step-watch case's A544 pre-push failure is fixed at a likely cause, not a confirmed
  one.** The failure's message was not kept. On 2026-10-16 (A770) it failed in a third shape,
  recorded in the detail. Next: if "reports the phase a synchronous call holds the thread in…" fails
  again, keep its message and compare it with the shapes in the detail.
  [Detail](backlog/ci.md#the-step-watch-cases-a544-pre-push-failure-is-fixed-at-a-likely-cause-not-a-confirmed-one)

- **Venue-service browser startup remains unexplained (#1557).** CI run `38170156450`
  attempt 1 timed out before any browser test started; attempt 2 passed on the same commit. A527
  did not reproduce it in 100 Linux repeats; a failed shard now keeps its start-up record. Next:
  when it recurs, read that record for the missing step. [Detail](backlog/ci.md#venue-service-browser-startup-remains-unexplained-1557).

- **CodeQL's `timeout-minutes: 50` rests on the default setup's durations (A488).** codeql.yml
  saves no overlay-base database, which the default setup's runs did, so its own durations may
  differ. Next: after a week of nightly runs, read their job durations and set the limit from them
  (docs/developers/ci-and-gates.md, "Every job has a time limit").

- **A419 dashboard CI stall remains unexplained (#1474).** Run `37932573955` left
  `catalogue-screen.test.ts` unfinished; local focused and full-package runs and diagnostic
  CI `37936013331` completed. Next: if it recurs, retain per-test progress and locate the waiting
  operation before changing the browser harness.
  [Detail](backlog/ci.md#a419-dashboard-ci-stall-remains-unexplained-1474)

_Formerly B9, and the old Track C's development-stack and house-rules items; part of A9._ Detail: [backlog/ci.md](backlog/ci.md).

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

- **The upgrade walk's historical runtime variation remains unexplained after reducing setup work
  (A736, [#1788](https://github.com/clintongormley/waitron/pull/1788)).** The captured 165,500/171,000 ms
  overruns have not been reproduced on the quieter host. On recurrence, retain the phase report and
  host state before retrying; compare repeated samples before assigning the variation to CPU
  scheduling or storage.
  [Detail](backlog/ci.md#the-upgrade-walks-historical-runtime-variation-remains-unexplained-after-reducing-setup-work-a736-1788)

- **What moving the upgrade test's scratch directory to `/dev/shm` (A122, #856) left open:**
  `scratchParent()` does not fall back to the disk when `/dev/shm` is nearly full, and on CI's Linux
  runner `scripts/scratch-dir.mjs` measures 83% of branches. Neither is queued. [Detail](backlog/ci.md#what-moving-the-upgrade-tests-scratch-directory-to-devshm-a122-856-left-open)

- **What the landing-port fix (A80, PR #740) left open:** `freePorts(n)` holds every probe until
  the last port is drawn, but a port is still released before the server binds it, so another test
  worker drawing or connecting in that gap can take it; nothing has measured how often.
  [Detail](backlog/ci.md#what-the-landing-port-fix-a80-pr-740-left-open)

- **`bundle-smoke` builds only the credentials and server bundles**, so a change to
  `scripts/bundle-node.mjs` selects print-agent and provisioning for typecheck and tests (#593,
  through `ROOT_SCOPE_CONSUMERS` in `scripts/changed-scope.mjs`) but builds neither of their bundles
  in CI.

- **The table-service, boot-and-counter and three `tender-pay-*` suites are separate files** that
  can be folded back into `till-app.test.ts` and `tender-pay.test.ts`. Left open by `apps/till`'s
  move to the high coverage bar (#536).

- **The spawn-timeout guard compares a bound against the LARGEST SINGLE wait, never the sum — OPEN,
  and the guard cannot close it.** A case that waits several times can still outlast a bound that
  passes this check. [Detail](backlog/ci.md#the-spawn-timeout-guard-compares-a-bound-against-the-largest-single-wait-never-the-sum)

- **What the per-push CI concurrency groups (#384) left open:** two states stop publishing until a
  person intervenes; the repair is to delete or retag `:main` by hand. Nothing alerts on it. [Detail](backlog/ci.md#what-the-per-push-ci-concurrency-groups-384-left-open)

- **Three unexplained incidents, each seen once or twice; on recurrence retain the log before
  retrying** (standing rule: a flaky test is fixed at the root). The original log and screenshot were
  kept; the cause is unexplained, so retain them again on the next sighting rather than re-running to
  green. [Detail](backlog/ci.md#three-unexplained-incidents-each-seen-once-or-twice-on-recurrence-retain-the-log-before-retrying)

- **The unexplained dashboard heading-order failure remains open** after #350. The
  `dashboard-app.a11y.test.ts` heading-order sighting is a different rule with no colour evidence,
  so nothing here explains it — treat it as still unexplained.

- **A sixth: a CI shard exited 1 with every test passing (PR #414) — the exit-1 path closed by the
  Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.** Keep the job log on the
  next sighting — it is the cheapest evidence there is. [Detail](backlog/ci.md#a-sixth-a-ci-shard-exited-1-with-every-test-passing-pr-414)

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

- **A810. Show that a product given an empty unit id is refused.** Since #611 no case in
  `packages/venue-service/src/operations.test.ts` shows it: its unit id is a placeholder. Add one
  case that gives a product an empty unit id and expects the refusal, which should come from the
  `product_units.unit_id` foreign key (`packages/catalogue/src/schema/units.ts:51`; read, not run).
  If it is not refused, fix that. Done when the case is in and passes.

- **Loose ends left by the comment-pruning pull requests (#559 to #624).** Each was found while
  pruning comments.
  - Two `health.test.ts` cases … feed a clean pass, so they check less than their titles say
    (#624).
    [Detail](backlog/ci.md#two-healthtestts-cases--feed-a-clean-pass-so-they-check-less-than-their-titles-say)
  - `.github/workflows/ci.yml` (about line 283) says the three-shell receipt sits in
    `.husky/pre-push` beside the same loop; it is not there (#602).
    [Detail](backlog/ci.md#githubworkflowsciyml-about-line-283-says-the-three-shell-receipt-sits-in-huskypre-push-beside-the-same-loop-it-is-not-there)
  - The v8-ignore reason "never run by `vitest run`" on schema files' extra-config functions was
    measured false (#562, #585). Four identity schema files and six in
    `packages/fiscal-verifactu/src/schema` keep the ignore pairs with no reason; removing a pair is
    a code change, for whoever next changes that package's code.
    [Detail](backlog/ci.md#the-v8-ignore-reason-never-run-by-vitest-run-on-schema-files-extra-config-functions-was-measured-false)
  - The `schema-conformance.test.ts` headers of `payments`, `workforce`, `media` and
    `workforce-es` say an unnamed unique constraint reaches the factory's refusal; drizzle-orm
    0.45.2 names an unnamed `unique()` itself, so nothing reaches it
    (`packages/db/src/testing/schema-conformance.ts`) (#559).
  - In `packages/db/src/change-log.test.ts` the case under "THIS CASE NO LONGER SEPARATES
    ANYTHING" repeats the first case under another name (a test change, not a comment one; #589).
  - The printing error test overstates its import requirement, and profile-store setup keeps a
    session across per-test resets (#588; the canvas-store test itself is retired).
    [Detail](backlog/ci.md#printing-error-test-wording-and-profile-store-session-setup)

- **`--no-verify`: the docs say "Claude never", the hook says "agents never"** — OWNER'S CALL (found
  2026-10-03 by #1139's review). **Next action:** the owner decides whether the rule covers every
  agent, then the two docs follow.
  [Detail](backlog/ci.md#--no-verify-the-docs-say-claude-never-the-hook-says-agents-never)

- **The shard layout was measured against an engine that is gone** — OPEN (found 2026-09-23, task
  F1's review wave). `packages/db`'s ten mutation shards have been timed on SQLite (2.9 to 12.2
  minutes on run 38241392066), but the count has not been re-cut from those times. [Detail](backlog/ci.md#the-shard-layout-was-measured-against-an-engine-that-is-gone)

- **The PGlite throughput bench no longer matches the shape it says it matches** — OPEN (found
  2026-09-21, task P6). Either bring the three decisions across and re-baseline, or change the
  sentence to say what it is.
  [Detail](backlog/ci.md#the-pglite-throughput-bench-no-longer-matches-the-shape-it-says-it-matches)
- **The PGlite throughput bench fails while seeding** — OPEN (found 2026-10-18, A861's review of
  #1856). Its seed insert binds two values but its SQL names only `$2`, so PGlite refuses it with
  `42P18`; on pglite 0.5.9 and 0.5.10 alike.
  [Detail](backlog/ci.md#the-pglite-throughput-bench-fails-while-seeding)

- **`packages/db`'s static mutants are not in its mutation score** — OPEN, left by A539.
  `"ignoreStatic": true` in `packages/db/stryker.config.json` leaves out every mutant in code that
  runs when a module loads (322 `Ignored` on run 38256003987, 229 of them in
  `src/classification.ts`). Stryker runs every test for each static mutant; what measuring them
  would cost has not been timed. Owner's call.

- **`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests** — left behind by raising
  the `packages/ui` mutation score (#466, 2026-09-20). Adding a third exclusion is the consistent
  move and also shrinks the denominator `mutation-ui-aggregate`'s bar of 90 is measured against.
  Owner's call. `packages/ui/src/vitest-pointer-gestures.ts` (A720 Part 4) is in the same position.
  [Detail](backlog/ci.md#packagesuisrcvitest-park-pointerts-is-mutated-and-has-no-tests)

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI** — left
  behind by the vite 8 upgrade (#450, 2026-09-19). `bundle-smoke` builds esbuild bundles only. This
  is the work item `CLAUDE.md` §2 and `docs/developers/ci-and-gates.md` point at.
  [Detail](backlog/ci.md#a-pull-request-that-changes-only-front-end-code-gets-no-spa-bundle-built-anywhere-in-ci)

- **The hint's cover stops at the migration run, and provisioning runs after it** (#343). A module's
  provisioning seat (`packages/catalogue/src/provisioning.ts` seeds units) executes once migrations
  succeed, outside `withDevMigrationHint`, so a seeding failure there on a stale database gets no
  curated line. Nobody has hit this.

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

- **The case "refused while the run is stopping" catches a log check blind to the stop only by the
  order two pending steps finish in:** in A538, with that check reading only the deadline, it passed
  once the refusal arrived one `setImmediate` later. Left open by #668, #686, A57, A60, #723, A538.

- **Loose ends left by SQLite slice 1 (#490 and the preparation tasks).**
  - Every `maxWorkers: 1` config whose comment gives the coverage reason, apart from `payments`,
    which carries its own measurement, still says the pin is needed without having measured it; the
    same one-worker-against-several coverage comparison would settle each.
  - P7's leftovers (#533): `no-tenant-column`'s SQL check still passed with one set's SQL dropped,
    because it checks for an absence and the remaining files clear its floor of eight.
    [Detail](backlog/ci.md#p7s-leftovers-533)
  - A few suites still build engine-shaped refusals by hand rather than through `refusalError`
    (`packages/db/src/testing/refusals.ts`, P10, #527), among them
    `packages/provisioning/src/cli.test.ts` and `packages/scheduler/src/store.concurrency.test.ts`.

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

- **A811. Check whether a catalogue-screen case still prints "[Unhandled rejection] Error:
  marker".** The case near line 2624 of `apps/dashboard/src/screens/catalogue-screen.test.ts`
  (added by #1087) printed it in passing runs. Run the file once; if it still prints, catch the
  rejection where it escapes (in the test or the screen); if not, delete this entry.

- **Loose ends left by W92 (#1250).**
  - Some dashboard pixel and drag cases W92 did not change failed once when run in parallel locally
    during the branch's work; the cause was not found. They passed in the PR's dashboard CI shard on
    its final head.

- **The guard W72d added (`scripts/id-columns-are-references.test.ts`) knows an id column only by
  its name**, so a reference named otherwise is still unseen. Left open by W72d (#1238).

- **W72h (#1247) stopped Chromium logging "ResizeObserver loop completed with undelivered
  notifications" from the Products tree's category name box.** A261-3 (2026-10-05) and A349
  (2026-10-08) then saw the message in other dashboard suites; that comparison does not establish
  which observer causes it or its effect on the rendered screen.
  [Detail](backlog/ci.md#chromiums-resizeobserver-loop-message-in-other-dashboard-suites-after-w72h)

- **Tests that close a dialog and then check after a single `flush` were not searched** (A452,
  #1487). Popovers (combobox, help tooltip, row actions) report their toggle late too, and were not
  looked at. [Detail](backlog/ci.md#tests-that-close-a-dialog-and-then-check-after-a-single-flush-a452-1487)

- **`pressEscape` in `packages/ui/src/components/wt-dialog.test.ts` waits a fixed 50 ms after each
  Escape.** **Next action:** decide whether "closes on a real Escape press" should wait for its
  `wt-close` instead, keeping the timer for the stays-open tests. Left open by service Task 11
  (#916). [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **`scripts/dashboard-browser-purity.test.ts` checks only some of venue-service's dashboard
  files**, because the whole folder fails the guard. **Next action:** list each browser-safe
  venue-service export as a file. Left open by the reviews of A261 step 5 (Hours, #1298) and by
  A585-4. [Detail](backlog/ci.md#the-browser-purity-guard-checks-only-some-of-venue-services-dashboard-files)

- **Task 2's review found no test that fails when `device_profile_admission_roles` or
  `device_profile_admission_persons` is left out of
  `apps/server/src/testing/clear-provision-fixture.ts`** (read, not run); both tables' keys into
  `device_profiles` cascade on delete (identity `0007_profile_admission.sql`). Left open by W97
  (#1311).

- **The payments test "refreshes only active reader statuses" failed once locally beside another
  coverage run**, then passed five times alone and in CI; not investigated. Left open by W100
  (#1332).

- **The server holds two separate 100-character limits for text a request sends**: `SEARCH_MAX`
  (`apps/server/src/orders-list.ts`, search text) and `TEXT_MAX` (`apps/server/src/orders-api.ts`, the Orders request's text fields).
  Changing one leaves the other. Left open by A454 (#1491). **Next action:** decide whether they are
  the same limit and, if so, share one constant.

- **Two browser tests failed once each during A454's work (search everywhere), and neither was
  reproduced or checked on `main`**: one in `wt-data-table.test.ts`, one in
  `units-reassignment.unsaved.test.ts`. **Next action:** reproduce each under load and fix at the
  root. [Detail](backlog/ci.md#two-browser-tests-failed-once-each-during-a454s-work)

- **The relocated independent department preview needs a load investigation.** The retired
  `receipts-screen.defaults.test.ts` case failed once during A463 and was not reproduced.
  A493 moves this behavior into the department receipt editor's language-independent preview cases
  (`apps/dashboard/src/screens/department-receipt-editor.preview.test.ts`).
  Reproduce that flow under load before assigning a cause; its retirement does not establish
  that the original failure is fixed.

- **A printers-screen test failed once during A435 step 2's review fixes and was not reproduced**:
  "a press after one edit sends the edit and the field as it was read". **Next action:** reproduce
  it under load and fix at the root.
  [Detail](backlog/ci.md#a-printers-screen-test-failed-once-during-a435-step-2s-review-fixes)

- **The test-shape half of #339's lesson is unwritten.** #339 passed review and CI and the first
  person to open the screen got a 500; the "open it and look" half is CLAUDE.md §4's rule. The
  other half — a matrix that varies two things separately and never crosses them proves less than
  it looks — wants its own line. Left open by content languages and the image library (#339).

- **A two-transaction concurrency test that starts both sides in sequence is racing itself.**
  Nothing guards the shape; look for it in any new racing test.

- **A trap not yet in `CLAUDE.md`: `pnpm --filter <pkg> test <file> -t "name"` silently drops the
  `-t` and runs the whole file**; only a bare `--` before it passes it through. **Next action:** add
  it to `CLAUDE.md` §2's trap list, through the normal pull request flow.

- **drizzle-kit 0.31.11 left out `ON DELETE` when it generated an `ALTER TABLE … ADD … REFERENCES`
  on this engine, while its snapshot kept it.** The schema-conformance suite compares declared
  delete rules with the migrated database for the sets that opt in; [A812's deletion
  experiment](developers/testing-guide.md#a-missing-delete-rule-fails-the-schema-comparison) caught
  one omitted rule. The generator omission was observed once by an implementer (five store tests
  failed with a foreign-key refusal), not independently re-run. Left open by A429 slice 1 (#1493).

### Dependency upgrades

_Formerly parts of B9 and Track C._ Detail: [backlog/dependencies.md](backlog/dependencies.md).

- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it** — left
  behind by the Stryker upgrade (#447, 2026-09-19). Stryker 10.0.0's release notes mention neither
  issue, and nothing here was run under Vitest 5, so the question is untouched rather than resolved.
  The retry removes the Vitest-major ignore in `.github/dependabot.yml` (A779; the Vitest 5 PR #1179
  is closed). Closing #766 stored an ignore of `@vitest/browser-playwright` 5.x; #1179 moved only
  `vitest`, so it did not show whether Dependabot obeys it. Owner, 2026-10-17: keep this open until
  Dependabot's next Vitest-family pull request shows whether A779's ignore holds, then close it
  (workflow-guide → Dependabot pull requests) — left open by Dependabot's switch-on (#760,
  2026-09-27).
  [Detail](backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it)

- **Bundled npm notices stop at a module-type-only package manifest.** Running
  `bundledNpmNotices` on Stripe's installed `cjs/stripe.cjs.node.js` returns no packages on both
  22.6.2 and 23.0.0. Stripe 23 carries a separate licence in `deploy/third-party/stripe/`; fix the
  generator to continue to the owning package and test both module layouts and workspace exclusion.
  [Detail](backlog/dependencies.md#npm-notices-and-module-type-only-manifests)

- **Comments and docs still name drizzle-orm 0.45.2 and 0.45.3; 0.45.4 is installed** — OPEN (found
  2026-10-03 by #1139's review). **Next action:** read each claim against the installed 0.45.4, then
  update the number or the claim.
  [Detail](backlog/dependencies.md#comments-and-docs-still-name-drizzle-orm-0452-and-0453-0454-is-installed)

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7** —
  left behind by the TypeScript 7 upgrade (#460, 2026-09-20). When a release supports it, the root
  entry goes back to a plain `^7` range and the alias disappears.
  [Detail](backlog/dependencies.md#collapse-the-two-typescript-entries-back-into-one-once-typescript-eslint-supports-version-7)

- **Whether a declared floor follows the installed version is undecided — one decision for every
  manifest** — left behind by the dependency refresh (#432, 2026-09-19). The answer goes in
  `versioning-strategy` in `.github/dependabot.yml`.
  [Detail](backlog/dependencies.md#whether-a-declared-floor-follows-the-installed-version-is-undecided--one-decision-for-every-manifest)

- **One esbuild copy older than ours stays in the tree: `drizzle-kit`'s own range holds it** at
  0.25.12; since A107 a root `pnpm.overrides` entry moves `@esbuild-kit/core-utils`' copy onto the
  same 0.25.12. An install that re-resolves the lockfile still warns that the `@esbuild-kit`
  packages are deprecated.
  Left behind by the esbuild upgrade (#439, 2026-09-19).

- **Loose ends left by the Node types upgrade (#441, 2026-09-19).**
  - **The root `package.json` says `"engines": { "node": ">=24" }` while `.nvmrc` says 26.** One
    line either way; it needs an owner call on whether Node 24 is still supported.

- **Loose ends left by the Hono Node adapter upgrade (#444, 2026-09-19).** `apps/server` and
  `apps/print-agent` moved from `@hono/node-server` 1.19.15 to 2.1.1.
  - **Only the request side of that adapter was compared between the two versions.** The suites
    pass, so nothing is known to be broken. Re-running the comparison needs a scratch install of
    1.19.15.
    [Detail](backlog/dependencies.md#only-the-request-side-of-that-adapter-was-compared-between-the-two-versions)
  - **`apps/server/src/tls.ts`'s type guarantee is still untested.** It derives its options type
    from the installed package (`Parameters<typeof serve>[0]`) so that an incompatible reshape
    fails `tsc`; this upgrade did not exercise that, because the type was otherwise identical
    across the two versions.

- **Loose ends left by the vite 8 upgrade (#450, 2026-09-19).**
  - **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo.** What
    is missing is anywhere that states a browser floor, so the next bump moves it again silently.
    [Detail](backlog/dependencies.md#the-default-browser-floor-rose-and-no-browser-floor-is-stated-anywhere-in-the-repo)
  - **The browser-mode packages that declare no vite follow the others' by deduplication, not by
    a declaration.** If a future change puts a second vite in the tree, they could land on a
    different one silently.
    [Detail](backlog/dependencies.md#the-browser-mode-packages-that-declare-no-vite-follow-the-others-by-deduplication-not-by-a-declaration)
  - **A dependency-optimizer receipt taken on vite 6 was not re-measured.** Nobody re-checked that
    vite 8 still emits that warning, or that the `include` lists are still the fix.
    [Detail](backlog/dependencies.md#a-dependency-optimizer-receipt-taken-on-vite-6-was-not-re-measured)

- **Loose ends left by the till QR library upgrade (qrcode-generator 1 -> 2, 2026-09-20).**
  - **The till's QR pin compares the code against itself, not an authority.** Giving the till the
    same reader needs a matrix accessor as well (`qrSvg` returns a string, never the library's
    `qr` object) and a module-boundary decision about where the helper lives.
    [Detail](backlog/dependencies.md#the-tills-qr-pin-compares-the-code-against-itself-not-an-authority)
  - **There is no snapshot file anywhere in the repository**, so the till's byte pin is a SHA-256
    of the output. A file snapshot would fail with a readable diff; whether this repo wants
    snapshot files at all is an owner decision.

- **`node-forge` has a high-severity security alert with no fixed version** — OPEN (Dependabot alert
  #20, 2026-10-01). Every version up to 1.4.0, the one in the lockfile, accepts some RSA signatures
  it should reject when checking them. It is a direct dependency of `packages/server-kit`,
  `apps/server` and `apps/print-agent`. **Next action:** bump it when a fixed version is published,
  and run the certificate suites in those three packages.
  [Detail](backlog/dependencies.md#node-forge-has-a-high-severity-security-alert-with-no-fixed-version)

- **Loose ends left by the passkey library upgrade (#453, 2026-09-19).** `@simplewebauthn/server`
  and `@simplewebauthn/browser` moved to 14.
  - **Whether the vulnerability the upgrade fixes is reachable in this product is open.** The
    cheap evidence leans towards reachable rather than away.
    [Detail](backlog/dependencies.md#whether-the-vulnerability-the-upgrade-fixes-is-reachable-in-this-product-is-open)
  - **The version-14 browser helpers are unused.** Whether `browserSupportsPasskeys()` would
    improve the login screen's `browserSupportsWebAuthnAutofill()` gate has not been assessed.

### Modules, data and code health

_Formerly B8, parts of B9, and the old Track C's correctness items; part of A9._ Detail: [backlog/architecture.md](backlog/architecture.md).

- **A760. Squash every migration set before go-live.** The [operator plan](superpowers/plans/2026-10-16-a760-migration-squash.md)
  and [inventory](superpowers/plans/2026-10-16-a760-migration-squash-inventory.md) are approved
  (owner, 2026-10-16), including fiscal SQL/meta and the named history-harness changes.
  The watcher starts the sole job after big work and migration branches drain, with the full
  Waitron/Cloud mutation freeze and named reset/operator roster recorded. Reset the laptop
  dev-stack slots and Santet venue through the plan; leave the owner's physical `waitron.local`
  off/quarantined, image pinned, for the owner to reset on return after 2 November.

- **A646 — a Modules page where the administrator switches optional modules on and sets them up (OPEN; revised design awaits agreement).**
  [Design](superpowers/specs/2026-10-16-a646-modules-page-design.md) and [mockups](backlog/mockups/a646-modules-page/README.md).
  Build waits for owner agreement and A739; retained protection comes first. Google's access-check scope remains undecided.
  [Detail](backlog/architecture.md#a646--a-modules-page-where-the-administrator-switches-optional-modules-on-and-sets-them-up)

- **Station deletion's draft-location filter needs a discriminating test.** In A435 step 5's
  second run-it review, deleting the `working_orders` location `exists` clause in
  `apps/server/src/station-delete.ts` left all 47 station-delete and management-delete cases
  passing. Add a second-location draft case that fails without the clause, or establish by running
  the real writers that it is redundant before removing it. Its necessity remains unverified.

- **The order-line schema's variant-name comment mistakes missing customer text for a null map.**
  `packages/db/src/schema/orders.ts` says `variantDescriptions` is null when the variant has no
  customer name. The existing working-order case "names a variant line with no customer or kitchen
  name" instead reads its frozen staff-name map. Left open by A612; remove the misleading comment.

- **Loose ends left by A435's printer, reader and device delete (steps 2 to 4).**
  - The till's status for an original whose printer was deleted uses the error code's sentence
    ("…this job will not be retried."), where its neighbours speak of "the original". Owner to
    choose the wording.
  - The Spanish for `printer.deleted` breaks its twin's pattern: "por lo que no se volverá a
    intentar este trabajo" where `printer.unpaired` says "así que este trabajo no se volverá a
    intentar".
  - Shorter printer-delete copy was offered to the owner during the build: for the till's
    deleted-printer sentence, the Spanish heading over ending work (now "Trabajo que finaliza"; a
    shorter "Lo que se detendrá" was offered, which in the present tense reads "Lo que se
    detiene"), and one dialog line per inherited default.
  - `refuseDeletedPrinters` lives in `@waitron/layouts` though `@waitron/printing` holds the
    printer functions and `printer.not_found`'s registry.
  - `deletePrinter` writes the device choices, profile lists and holders that layouts owns; one
    layouts function could clear them.
  - Several printer queries that already require an active printer or a live job also filter
    `deleted_at`; one test pinning "deleted means switched off with no live jobs" could replace
    the copies.
  - The devices and payments screens copy the printers screen's delete-dialog logic
    (`apps/dashboard/src/screens/devices-screen.ts`, and since A435 step 3 `payments-screen.ts`).
    Pull it into one shared piece, with the `names` helper that `printer-delete-copy.ts`,
    `reader-delete-copy.ts` and `device-delete-copy.ts` each repeat and the `line` helper the
    first two share. Left open by A435 step 4 (#1519) and step 3.

- **Loose ends left by A435 steps 3, 3b and 4 (#1520, #1524, #1519).**
  - "A device that is not deleted" is written by hand as `isNull(devices.deletedAt)` in several
    files; one named check would keep a new query from forgetting it. Step 4 (#1519).
  - A Stripe reader's delete confirmation does not say the reader stays registered at Stripe, which
    a SumUp reader's does while SumUp is not connected. Step 3b.
  - The till names a reader deleted elsewhere with `reader.not_found`'s general sentence ("This
    device has no card reader it can use…", `apps/till/src/i18n/codes.ts`), where a deleted printer
    has its own "That printer no longer exists". Owner to choose whether readers get one too. Step 3
    (#1520), whose plan kept the existing sentence.

- **The Disable dialog's failed-unpair message says the reader is "still enabled"** (A518, #1562),
  which is untrue if another session disables it while the dialog is open, because the Unpair route
  checks only that the reader exists. Left as it is: right whenever nobody else acts at the same moment.

- **Unchecked: pairing a new reader can undo the SumUp registration it just made** when SumUp is
  disconnected during the add (the "Disconnected mid-add" branch of the add-reader route,
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

- **`bookings`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`cadenas`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`card_readers`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`catalogues`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`change_log`: decide the remaining UPDATE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`content_languages`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`convenio_config`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`daily_close_chain`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`departments`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`devices`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`drawer_opens`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`employments`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`envio_flujo`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`envios`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`floor_zones`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`incidents`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`ingredients`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`invoice_series`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`join_requests`: decide the remaining UPDATE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`kitchen_stations`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`location_catalogues`: decide the remaining UPDATE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`locations`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`management_sessions`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`menu_items`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`media_image_data`: decide the remaining UPDATE/DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`node_membership`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`payment_policy`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`payment_refunds`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`payments`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`persons`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`print_agents`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`print_jobs`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`printers`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`products`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`registro_sif`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`scheduled_runs`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`sessions`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`station_printers`: decide the remaining UPDATE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`table_service_statuses`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`tenant_receipts`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`tenant_themes`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`ticket_items`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`workforce_chains`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`working_order_counters`: decide the remaining DELETE restriction (A805 follow-up).**
  Check the intended retention and mutation paths before adding enforcement.
  [Audit](developers/grants-retirement-audit.md#unresolved-restrictions)

- **`apps/server` route-suite test titles still say "not a 500" or that an unscreened malformed id
  becomes an opaque 500, although ids are text columns now.** The titles name no engine; none has
  been probed against today's behaviour. Left open by C127 (#1036, #1042) and found again by #600
  while pruning comments.
  [Detail](backlog/architecture.md#appsserver-test-titles-still-say-an-unscreened-malformed-id-becomes-an-opaque-500-although-ids-are-text-columns-now)

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

- **Pointers outside `docs/` that #597 made stale** — found by #597 while pruning comments. The fake
  SumUp client leaves its one-shot switches for a lookup or a refund armed when a checkout before
  them is refused; no test combines the two.
  [Detail](backlog/architecture.md#pointers-outside-docs-that-597-made-stale)

- **"Nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`)" … is too
  wide** — found by #567 while pruning comments. The same claim stands in
  `packages/fiscal-verifactu/src/venue-fields.ts`.
  [Detail](backlog/architecture.md#nothing-under-apps-may-import-a-regime-package-scriptsmodule-seamstestts--is-too-wide)

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
  [Detail](backlog/architecture.md#decimaltocents-refuses-an-amount-over-the-bound-583-but-centstodecimal-itself-has-no-digit-bound)

- **Loose ends left by A394-3 (#1447).**
  - `GET …/locations/:locationId/catalogues` and the member `DELETE` answer as before for an
    unknown location.
  - A malformed menu or location path id still answers 400 `shared.invalid_id` until A394-22,
    while the course route answers 404.
  - The two location routes' body menu id keeps 404 until A394-11.
  - Workforce refuses an unknown BODY location as `management.request_invalid` while catalogue's
    PATH location answers `location.not_found`. If workforce moves to the new code, declare it in
    `packages/db/src/errors.ts`.

- **A394-5, A394-6, A394-8 to A394-17 and A394-20 to A394-22 — refusal statuses by one rule** —
  OPEN, low priority, not queued — owner 2026-10-08: take them from here when a lane has room.
  (A394-1 to A394-4 landed as #1441, #1444, #1447 and #1455.) The follow-ups and the rows:
  `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.
  [Detail](backlog/architecture.md#a394-5-a394-6-a394-8-to-a394-17-and-a394-20-to-a394-22--refusal-statuses-by-one-rule)

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
  export one validator from `@waitron/shared`; `packages/store` depends only on `@waitron/shared`,
  which depends on nothing, so that edge closes no loop.
  [Detail](backlog/architecture.md#three-copies-of-one-sql-identifier-validator-and-two-cause-chain-walkers)

- **Raw engine imports in `apps/server/src/recovery-lock.ts` and
  `apps/server/scripts/cloud-backup-fixture.ts`** — left open by W45 (#1155). **Next action:**
  review each remaining raw connection separately before deciding whether a shared store API fits.
  [Detail](backlog/architecture.md#raw-engine-imports-in-appsserversrcrecovery-lockts-and-appsserverscriptscloud-backup-fixturets)

- **Files that still spell the store's file names themselves** — left by #757, which exported them
  from `@waitron/store`. #757's checks do not cover `migrations.lock`, Litestream's
  `.venue.db-litestream/` folder, or the restore's `venue.db.incoming` file and
  `.venue.db-replaced-*` folder.
  [Detail](backlog/architecture.md#files-that-still-spell-the-stores-file-names-themselves)

- **Two leftovers of the restrict/trigger refusal split (#731).** `isRefusal` with
  `RESTRICT_VIOLATION` or `TRIGGER_ABORT` still reads the number alone and both stay exported (the
  `CLAUDE.md` §3 rule, unguarded, is what stands against a new caller); and the four near-identical
  word-matching checks in `packages/db/src/constraint-target.ts` could share one private helper.

- **Loose ends left by A483 (#1544).** OPEN.
  - **A switched-off module's append-only tables are neither re-protected nor checked.** A start
    migrates, re-protects and checks only the modules switched on.
    [Detail](backlog/architecture.md#a-switched-off-modules-append-only-tables-are-neither-re-protected-nor-checked)
  - **Putting back a changed append-only trigger is a hand-typed command.** Retry cannot clear
    `append_only.triggers_changed` for a changed trigger; the installer runs the `node -e` drop in
    `deploy/README.md` (_When the page names `append_only.triggers_changed`_) and then presses
    Retry. **Next action:** decide whether Waitron ships that as an operator command.
  - **The append-only check does not read `PRAGMA recursive_triggers`.** With the pragma off,
    `INSERT OR REPLACE` rewrites an append-only row without touching a trigger (measured,
    `docs/developers/conventions-data.md`); `apps/server/src/append-only-watch.ts` reads only the
    triggers' stored text. Whether anything on a running server can turn the pragma off is
    unmeasured.

- **`apps/server` → `apps/print-agent` is the first app-to-app workspace edge in the tree** — left
  behind by the TypeScript 7 upgrade (#460, 2026-09-20). Moving the WHOLE cohort would settle it,
  and that is a print agent layering decision.
  [Detail](backlog/architecture.md#appsserver--appsprint-agent-is-the-first-app-to-app-workspace-edge-in-the-tree)

- **Location-scope the by-id verb family together** (`getHeldOrder`/`getPlacedCounterOrder`/
  `updateHeldOrder`/`abandonHeldOrder`/`openTab`) when multi-location lands.
  [Detail](backlog/architecture.md#location-scope-the-by-id-verb-family-together)

- **Nothing stops two queries being started at once on one transaction.** The rule and its receipt
  are in `docs/developers/conventions-data.md` under "Multi-table writes share ONE transaction"; no
  test or lint rule enforces it. A guard could fail a test whenever a query is issued on a
  transaction while another is still running.

- **A806. Throw `sale.number_reused` when a sale would reuse an invoice number.** The code is
  declared in `packages/core/src/errors.ts` (with the series and the number) and nothing throws it.
  Where a sale is written, catch that index's refusal with `refusalOn(error, UNIQUE_VIOLATION,
  { table: "sales", columns: ["series_id", "invoice_number"] })`
  (`packages/db/src/constraint-target.ts`). The refusal names the table and columns, never the
  index (`sales_series_invoice_number_key`), so `indexViolated` cannot match it. Then throw `sale.number_reused` with the series and the number. Done when a
  test forces a duplicate number and asserts that code. FULL review (fiscal invariant).

- **Loose ends left by the tenant-column removal (#378, 2026-09-16).**
  - **These index and key names still read `tenant`, and the columns they name are gone.** This is
    its own slice, not a tidy-up: THREE of the four `persons_*` names are matched BY NAME in
    production error translation, so renaming them changes behaviour and wants its own failing
    tests first.
    [Detail](backlog/architecture.md#these-index-and-key-names-still-read-tenant-and-the-columns-they-name-are-gone)
  - **`server.credential_unusable` names an unusable credential, although `server.*` is reserved
    for facts about the process itself.** **Next action:** choose a prefix (`credentials.missing`
    is the nearest sibling) and rename it in one change, checking the prefix matchers
    `docs/developers/conventions-data.md` lists.
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

- **SP-4 — the module UI surface on the TILL** (card-registry inversion, self-sourcing cards); the
  dashboard half is done. Migrate the remaining core dashboard screens onto the module UI seat and off
  the coarse `requiresManager` gate. A core nav item can now also name a `requiresPermission`
  (`apps/dashboard/src/dashboard-app.ts`); Servers (`mirror.create`) is the first to use it.

- **No route raises `menu_item.variant_not_allowed`**: `addProductToMenu` is its only thrower and
  the demo seed its only caller outside tests. The code and its 400 in
  `apps/server/src/catalogue-api.ts` are left for whoever next prunes unraised codes.

### Data protection and legal compliance

_Formerly entries spread across the old sections._

- **A664 — archive or delete a venue's old data once it no longer has to be kept.** Revised
  proposal adopted for specialist review (owner, 2026-10-17); relevant adviser agreement,
  build and verification remain open. You will send Q48; six years remains the discussion
  baseline. [Detail and audit](backlog/data-protection.md#a664--archive-or-delete-a-venues-old-data-once-it-no-longer-has-to-be-kept)

- **libvips is LGPL-3.0-or-later** and ships in the box image with its notices and a written
  source offer in `/app/third-party/` (`deploy/third-party/`). The legal advisor is asked to
  confirm it (`docs/compliance/action-plan.md`, 2026-09-23). Left open by photos shrunk
  on upload (#543).

- **cairo, built into that libvips, is listed under the Mozilla Public License, and `/app/third-party/`
  carries neither its licence text nor a source offer for it** — found by A775 (#1760, 2026-10-16).
  The legal advisor is asked (`docs/compliance/action-plan.md`, 2026-10-16). **Next action:** add
  the licence text and source notice the answer calls for.
  [Detail](backlog/data-protection.md#cairo-built-into-that-libvips-is-listed-under-the-mozilla-public-license-and-appthird-party-carries-neither-its-licence-text-nor-a-source-offer-for-it)

### Later and parked

_Formerly the "Later and parked" paragraph under What's built._

**Later and parked** (no owner decision pending; reopen when work reaches them): Square and
generic CSV menu import · accounting export (SP17) · opening hours and channel sync (SP19) ·
per-seat ordering and multiple tabs per table (each reopens a
settled decision — specced with the owner, never landed unattended) · KDS ops polish (routing
audit view, station kind, definable kitchen statuses) · recipes depth (nested
sub-recipes, plate costing, stock depletion, variants, customer-facing browse) · inventory and
procurement (SP20; the AI forecast waits for the deterministic system) ·
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

- **Joining tables suggests their combined seats, still editable (A747, owner, 2026-10-16).**
  Implemented for the till's joining and split/rejoin windows and the dashboard's Add joined table.
  [Decision and limits](backlog/till.md#joined-table-seat-suggestions-owner-2026-10-16-a747).


From the 2026-09-05 whole-project design review and since. They supersede older spec text where they
conflict.

- **Box image identity (A490, owner 2026-10-11):** the script reports the commit and build time
  of each running Waitron image. [Decision](backlog/box.md#decisions-and-deliberate-limits).

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
| 17  | Accounting export            | —                                                                                                                                                                                                                                                                                                                                                                                                                                 | not started (core subset; extends Reporting)                                                                                                                                  |
| 18  | Menu/recipes/allergens       | EU-14 allergens, recipe/BOM allergen inheritance, recipe-authoring UI (**withdrawn from the dashboard by #345**; declarations are now direct on the product), product images, location↔menu membership, extras and options lists end to end (the legacy option groups are gone — Task 13 dropped their tables), per-option and dish-line quantity, dietary classification, order-line customisation; departments and menus (#297) | menu schedule (publishing landed, #677); customer-facing menu surface parked; nested sub-recipes / plate costing / stock depletion parked       |
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
[the shortened list](compliance/asesor-questions.md#the-shortened-list-2026-10-09). Send that, asking
for a fixed price. Before paying for answers, re-read the list against the current Waitron
architecture.
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
| F3 canje (`IDOtro`, a separate F3 series, `Destinatarios` XSD)                                        | foreign recipient refused; A231's branch requires `full`                                                                                                                                                   | fields and identity types answered from AEAT's technical rules; R4 |
| Q27–Q29 (paying a bill in parts, a table that leaves without paying, how a comp or discount shows)    | parts: server built (#721), the till does not use it yet; comps and discounts built (#916); leaving without paying built on the owner's decision (B17)                                                     | S3, S6, S10 (A445, A447) |
| Q31 (correct an issued ticket by differences or by substitution)                                      | `recordCorrection` files by differences (`"I"`); no route calls it _(2026-10-02, C126: the whole-order cancel route now calls it for a whole-invoice credit)_                                              | **Answered**: the business's choice (art. 15.5; AEAT FAQ) |
| Q32 (how a cancelled order's already-issued simplified invoice is undone)                             | the whole-order cancel credits the invoice in full with an R5 corrective invoice, not an annulment (C126)                                                                                                  | S7 |
| Q42 (a bill paid later by transfer: invoice now, or a proforma and the invoice on payment; F1 and F2) | no till action issues an invoice for the customer to pay later (only invoice-first placing and an unpaid departure issue one before payment); a payment by transfer is refused (`sale.unsupported_tender`) | Option 2 not lawful for a consumer; deposits S8, unpaid debts S6 |

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
scoped. A664’s [proposed retention map](superpowers/specs/2026-10-16-a664-data-retention-design.md)
awaits owner and relevant specialist approval under its own gates; the broader privacy programme
remains open.

---

## Reference

**Adding a database test to a new package.** Give the suite `useVenueDb` and the migration sets it
needs; it makes its own temporary venue directory. A worker limit is still a per-package call, and
the reason that is left is the `@vitest/coverage-v8` cross-fork branch-merge artifact, which needs
`maxWorkers: 1` where a small package runs under `pnpm -r` oversubscription — the worked reasoning
is in #558's first commit message (2026-09-24). `packages/db` keeps `maxWorkers: 4`, which CI's
`test-heavy` shards inherit because they pass no worker count of their own. Either way a new package
that copies one of those configs must hold `98/98/98/95` (CLAUDE.md §2) — anything else and
`scripts/coverage-thresholds.test.ts` fails it in the ungated `root-guards` job.

**Specs still in the tree** (checked against the code 2026-09-27). A spec whose work is built is
deleted once nothing points at it; one stays while a developer doc or code comment points at it, or
while it holds decisions still open.

| Spec                                                                                                                                                                                              | State                                                                                                                                                                      | Open work lives in                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [POS architecture](superpowers/specs/2026-07-18-pos-architecture-design.md)                                                                                                                       | the strategy; §2's sub-projects                                                                                                                                            | _What's built_                                                            |
| [Workforce and time record](superpowers/specs/2026-07-22-workforce-and-time-record-design.md)                                                                                                     | clocking, corrections, Hours and working-time exports built; inspector access, advisor checks and payroll remain                                                                                                                                               | _Working time and staff_: inspector access, advisor checks, payroll and wages                 |
| [Deli hardware](superpowers/specs/2026-07-30-deli-hardware-design.md)                                                                                                                             | partly built; the outage path changed 2026-09-11                                                                                                                           | _Payments and card readers_                                               |
| [Nested sub-recipes](superpowers/specs/2026-08-16-nested-sub-recipes-design.md) and its plan                                                                                                      | not started; parked; the plan predates SQLite and Vitest 4                                                                                                                 | _Later and parked_ (recipes depth)                                        |
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
