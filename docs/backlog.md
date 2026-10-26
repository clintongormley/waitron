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

Ranked by the owner on 2026-10-16, for the time they are away (17 October to 2 November). Each item
is its own brainstorm → spec → plan → PR; fiscal-adjacent ones take owner sign-off at land.
Everything not listed here needs more spec work first.

1. **A773-2 — firing and the pass** (_The till, devices and table service_). Implement the
   [reviewed plan](superpowers/plans/2026-10-19-a773-2-firing-and-pass.md) for the remaining
   kitchen and pass work, following A773-1's Sent and New order panel.
   **A803 — bills and tables** follows A773-1 (owner, 2026-10-18); its pass and station-setting
   slices wait for A773-2.
2. **A646 — a Modules page where the administrator switches optional modules on and sets them up**
   (_Modules, data and code health_). Its revised design awaits agreement.
3. **A664 — archive or delete a venue's old data once it no longer has to be kept** (_Data
   protection and legal compliance_). Adviser agreement, build and verification remain open.
4. **A582 — help mode: a "?" in the top bar marks everything that has help** (_Users, sign-in and
   the dashboard shell_).

**A802 — correct part of a paid invoice** (_Fiscal records, invoices and the asesor_) has a
[design approved on 2026-10-21](superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md)
and a [build plan](superpowers/plans/2026-10-22-a802-partial-paid-invoice-correction.md).
Implementation still needs the plan's protected-writer approval and qualification; this is not
ranked against the list above.

**Remote access unblocks the customer-facing features, so it comes first among them (owner,
2026-10-22).** Online booking (A1013), the table's QR code (A508), online ordering for collection
(A509) and delivery (A1012) all reach the box through the venue's Cloud instance. They come soon
after go-live, not at it: "The remote access is the bottleneck for most of these features, so we
need to get that working soon." This repository's part is **A951**, the box's lasting tunnel and
public-certificate client (_Replication, failover and the cloud_).

**Lower priority (owner, 2026-10-16).** These were the top of the list ranked 2026-09-27; they now
come after the list above:

- **Finish table service and paying a bill in parts** (_The till, devices and table service_).
  What Task 16 (counter handover, #981) and Task 17 (#991) left open is in their entries under that
  area. **Send the asesor's [shortened list](compliance/asesor-questions.md#the-shortened-list-2026-10-09)
  (S3, S6, S10 cover Q27–Q29).**
- **Design the fixed screens for each kind of device** (A182 part 1, under _The till, devices and
  table service_). The Counter cleanup is built; A738 custom items and A739 paying remain.
  The handheld, kitchen screen and pass are **A797**: the owner answered Q42 on 2026-10-18 and
  Q51 on 2026-10-24 (all recommended; the Ready warning time in each prep station's editor), so
  nothing waits for Q51. Slice 4 (zones on a handheld) landed in #2041 and slice 5 (the Ready
  bar and List/Map kept per zone on the device) in #2063, and slice 1 (table short names, data)
  in #2076, and slice 2 (the dashboard's short-name field, which refuses a "+") in #2083, built
  from the build plan below; slice 3 is next. A773-2 builds the pass's part, and the phone's
  order screen waits for A803's slice 3: [design](superpowers/specs/2026-10-18-a797-device-screens-design.md) §8,
  [build plan](superpowers/plans/2026-10-24-a797-device-screens-build.md),
  [mockups](backlog/mockups/a797-device-screens/).
- **What a standalone box still lacks before a real venue runs it** (under _The box: backups,
  upgrades and recovery_): upgrade testing with rows the product itself writes and a real older database (owner-marked blocking before go-live); the bootable USB
  installer (B3); what the box does when a part fails but it can still sell (A798-B, the build:
  [design](superpowers/specs/2026-10-19-a798-degraded-trading-design.md) revision 7; slices 1 to 10 landed; slices 9b and 9c are outlined).
- **The displays and the printers walked at the real box** (_The till, devices and table service_;
  _Printers, the print agent and receipts_) — till, handheld and KDS through
  [ui-review.md](ui-review.md), and the first physical print since #327.
- **Smaller, independent pieces**, in no fixed order: refusing requests from a device that is not
  enrolled; Logging Slice 2, the one-touch bug report; the first real Bluetooth pairing at the box
  through the dashboard.
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

- **A1089: diagnose persistent AEAT certificate-check failures in the app.** The certificate
  dialog offers file/type changes, another check and Cancel. Add connection/configuration
  diagnosis with an applicable repair choice and any needed sign-in there; retry alone does not
  resolve every HTTP or unclassified failure.
  [Remaining workflow](backlog/self-service-refusals.md#certificate).

- **A1089: reconciliation alerts need a production caller and an evidence/decision route.** The
  scoped caller search found only library tests; the server loop schedules payment reconciliation.
  Specify the fiscal caller, authority and cadence before adding recovery choices or promising a
  periodic check. [Audit and remaining work](backlog/self-service-refusals.md#fiscal-reconcile).

- **A1089: fiscal environment refusals need safe configuration or recovery guidance.** Separate a wrong host environment from missing immutable metadata. Never relabel records, promote test data or reset invoice numbering.
  [Audit](backlog/self-service-refusals.md#fiscal-environment).

- **A1089: a fiscal reply-line mismatch needs accurate retry and evidence choices.** Describe only the drain behavior actually exercised, then offer evidence inspection and a decision path for persistent malformed replies, with any required sign-in there.
  [Audit](backlog/self-service-refusals.md#fiscal-reply).

- **A1089: fiscal filing-case alerts need a real decision route.** Use W41s-8/W41s-9 when released, or keep the missing workflow explicit. Rejections, cancellations, duplicate conflicts and repeated refusals cannot be fixed by an invented retry screen.
  [Audit](backlog/self-service-refusals.md#fiscal-cases).

- **A1089: fiscal integrity and validation alerts need evidence-preserving next steps.** Replace support-only guidance without editing records or treating every warning as a proven Waitron bug. A substantial missing recovery workflow requires an owner decision.
  [Audit](backlog/self-service-refusals.md#fiscal-integrity).

_Formerly A1 (with A1a–A1e, A231, A231d, A275 and W41s), and the old Track C's fiscal items; part of A9._ Detail: [backlog/fiscal.md](backlog/fiscal.md).

- **A940. Waitron's declaración responsable — design approved 2026-10-22; slice 1 landed
  2026-10-23 (#2000).** The producer's statement that a version meets the Veri\*Factu rules, one per release,
  readable on every terminal and before installation (compliance plan Step 8). The
  [design](superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md) drafts the text
  from AEAT's worked example, makes `pnpm release prepare` land each version's copy in a pull
  request and `pnpm release tag` tag it, adds About Waitron to the dashboard, the till's More menu,
  an ⓘ corner and the setup wizard, serves it at `/legal/declaration` before setup, on the
  plain-HTTP page and on the recovery page, attaches it to each GitHub Release, and gives the
  `@waitron/verifactu` library its own declaration. The owner answered all four questions on
  2026-10-21: he is the producer (his name, NIF and a publishable postal address are still to be
  supplied); e) = «S» for this version and f) = «N»; item d) is the draft sent to the asesor as
  Q53, pending their answer; production boxes run releases only. The owner approved the second revision on 2026-10-22 (about 02:45) and chose
  A993's offline behaviour (about 02:55); the third revision folds those answers in. Slice 1,
  built from its [plan](superpowers/plans/2026-10-22-a940-1-software-identity.md), landed on
  2026-10-23 (pull request #2000): every record kind's software block, built in
  `buildSistemaInformatico` (`packages/fiscal-verifactu/src/backend.ts`), names "Waitron", the
  build's version (`0.0.0-dev`, plus the build's commit on a published build) instead of `0.0.0`,
  and `TipoUsoPosibleMultiOT = N`. The producer is a marked placeholder until the owner supplies
  his name and NIF: meanwhile records still carry the taxpayer's name and NIF there, and a
  published build set to production refuses to trade (`sif.producer_unset`). Two test checks
  changed with it: the Spanish practice sales were re-recorded (only their software block moved),
  and the pinned digest of the shipped XML in `apps/server/src/full-comp.fiscal-identity.test.ts`
  changed (the owner accepted it on 2026-10-23). Still open: the producer's name and NIF (Task 8 of the plan), then
  slices 1b to 6, and A993's plan. Still needed from outside: his name, NIF and publishable
  address, and the asesor's answer to Q53.
  [Mock-ups](backlog/mockups/a940-declaracion-responsable/README.md)

- **A993. A change of the system's identity opens a new installation by itself — designed in A940
  §5.6, approved 2026-10-22; fiscal, the owner lands it.** AEAT identifies an invoicing system by the taxpayer's NIF,
  the two-character code and the installation number, and the code counts only together with its
  producer's NIF, so a new producer (the owner → a future Waitron company), a new code, or a move
  to another fiscal policy (the owner: one installation, one policy) makes a different system.
  Each chain stores the producer and compliance mode it was opened under (today `registro_sif`
  stores neither, `packages/fiscal-verifactu/src/schema/sif.ts:20-22`); the upgrade's step and
  every start compare them with the running release's and, on a difference, open a new installation, series and chain in
  one transaction, on the filing node only, through a new `identity-change` activation that only
  the upgrade's step, or a start that finds the change not made, can authorise (A947's slice 4a
  amends CLAUDE.md §5's "does not mint an installation number" sentence; A993 adds the one
  allocation no person asks for); a guard, proven by deletion, refuses to add a record to a chain
  opened under another identity. Corrections of invoices issued before the change join the new
  chain; the design asks for asesor Q53(d)(2) to be widened to cover that. The name is A947's
  five-symbol UTC minute (A947 §6.5), so A947's slice 4a lands first; no new recovery sheet is
  asked for. Because A947 needs a second clock for every name and a start has nobody present, the
  design has the upgrade check the clock while the old release still serves, and make
  the change only once that check passes — otherwise the old release never stops. A sale can still
  wait on the internet after a crash between the migration and the change, or when the new release
  is started by hand; and a power cut during the upgrade's stop leaves no app running until the
  upgrade runs again, until the restart-at-boot step the design adds is built. Chosen by the owner
  on 2026-10-22 (A940's second-revision question 2, about 02:55), with one addition: in that stuck
  case the page the box shows instead of trading also accepts a phone's or a till's clock under
  A947's clock rule, and explains every wait with a countdown (design §5.6, "The stuck page";
  picture 6). A947's slice 4a landed as #1990 and A940's slice 1 as #2000; its plan comes
  after slice 1's, and it lands before the first production venue goes live. A move between fiscal modules stays a refused start
  until the first non-Veri\*Factu mode.
  [Design](superpowers/specs/2026-10-21-a940-declaracion-responsable-design.md#56-when-the-systems-identity-changes-a-new-installation-by-itself-a993)

- **A696. Invoice issue dates and record offsets follow the process zone.**
  Every new invoice date/offset, ordinary receipt and till must use the saved venue zone,
  DST included; old records stay unchanged. The owner approved the
  [startup design](superpowers/specs/2026-10-20-a696-startup-zone-validation-design.md)
  on 21 October, including the minimal A166 country-zone list and creation/import checks first.
  Follow the [implementation plan](superpowers/plans/2026-10-21-a696-startup-zone-validation.md):
  validate before trading, check every saved-zone writer and let a manager confirm only a
  missing/invalid zone. Implementation and runtime acceptance remain open; the separate FULL
  fiscal PR finishes green for the owner to land. Keep wider A166 work and A444 separate.
  [Detail](backlog/fiscal.md#walk-up-invoice-dates-follow-the-server-process-time-zone).

- **A444. A full invoice for a meal past midnight should carry the day the meal ends**, not the day
  the bill was opened (A231's provisional rule). The 2026-10-09 research found a binding ruling dating
  a service at its end (V1476-13, by analogy); asked as [S4](compliance/asesor-questions.md#the-shortened-list-2026-10-09). Change before F1 is switched on.
  Fiscal: the owner lands it.

- **Can a simplified invoice carry an operation date different from its issue date?** — left open by A663 Part 2. If it can,
  art. 7.1.c requires that date on the receipt. The document builder already prints one on a
  simplified receipt, in captioned rows, whenever the receipt's data
  carries one (`apps/server/src/receipt-document.ts`, A754), but no sale has one: the only writer of
  a sale's operation date writes none without a customer tax identity
  (`packages/core/src/record-sale.ts:284-286`). Check, then record the date on such a sale if needed.

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
  An unusable `TiempoEsperaEnvio` is not recorded anywhere (the raw value is dropped).
  [Detail](backlog/fiscal.md#loose-ends-left-by-a230-waitronverifactu-021-1099)

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

- **Adviser confirmation: supplier invoice numbers by issue year.** Confirm the owner's A981
  rule in [Q18(b)](compliance/asesor-questions.md): the same supplier's number is refused within
  one issue year and accepted in another with a warning. The receipt date still sets the VAT
  reporting period.

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

- **A555. Keep a counter full invoice's email or A4 choice through payment** — DESIGN PROPOSED,
  awaiting the owner's one delivery-choice decision and full-design approval.
  No implementation or public F1 enablement is included.
  [Detail](backlog/fiscal.md#a555-counter-full-invoice-delivery-through-payment--design-proposed-2026-10-21)

- **A556. A full invoice that later replaces a bill's simplified one would not be delivered through
  the bill.** Nothing issues an F3 today: no route calls `recordSubstitution`.
  [Detail](backlog/fiscal.md#a556-a-full-invoice-that-later-replaces-a-bills-simplified-one-would-not-be-delivered-through-the-bill)

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

- **A275. Invoice a bill paid later by transfer (full or simplified invoice)** — DESIGN APPROVED; [reviewed plan](superpowers/plans/2026-10-22-a275-final-transfer-close.md) published, build pending.
  Invoice at the meal, close finally by transfer, preserve sibling/service checks, and export for the accountant; no later receipts or debt.
  The precise H2 writer approval, released clock/Pay contracts and separate F1/delivery/physical gates remain.
  [Design](superpowers/specs/2026-10-22-a275-final-transfer-close-design.md), [pictures](backlog/mockups/a275-final-transfer-close/README.md), [detail](backlog/fiscal.md#a275-invoice-a-bill-paid-later-by-transfer-full-or-simplified-invoice--design-now-2026-10-17).

- **A679 follow-up: pin the clock's future-finished sample refusal.** A serial review fault
  bypassing that internal stale-reading check survived the hour suites. Add both the refusal
  and its legitimate-order positive without changing clock policy.
  [Detail](backlog/fiscal.md#pin-the-clocks-future-finished-sample-refusal).

- **A679 follow-up: pin committed hour preparation's action boundary.** A serial review fault
  removing its restore/re-register-only check survived the owning suites. Test that internal
  boundary separately from the real public promotion retry, which already preserves its result.
  [Detail](backlog/fiscal.md#pin-committed-hour-preparations-action-boundary).

- **A679 follow-up: pin the early recovery-source refusal.** The later selected-source guard
  catches the review fault; the earlier refusal at `recovery-preparation.ts:271` lacks its own
  distinguishing case. Preserve both guards while adding that qualification.
  [Detail](backlog/fiscal.md#pin-the-early-recovery-source-refusal).

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
  authority.** Complete the copy and authenticated establishment path before presenting a successful fiscal
  join. The pending file alone supplies no live authority.
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

- **A receipt printer can lose its reply after printing.** Automatic delivery retries and an
  exhausted original's retry retain the original bytes. The customer may therefore receive an
  extra unmarked sheet when the previous attempt printed but its reply was lost. **Next action:**
  decide how an uncertain physical delivery should be recovered; request deduplication alone does
  not establish one physical print. [Detail](backlog/fiscal.md#uncertain-receipt-delivery)

- **A888. After A795 lands: the owner's checks with real certificates** (left open by A795). The
  owner approved landing A795 on 2026-10-19 before these ran.
  If any answers differently from the design, that part is redesigned in a follow-up.
  [Detail](backlog/fiscal.md#a888-after-a795-lands-the-owners-checks-with-real-certificates)

- **A853. The box makes a company seal's private key itself** (decided out of A795, 2026-10-18).
  Design one flow for setup and renewal: the box makes the key
  and request, the owner pastes the request into FNMT's form, and the box takes back only the issued
  certificate. Fiscal: the owner lands it.
  [Detail](backlog/fiscal.md#a853-the-box-makes-a-company-seals-private-key-itself)

- **VAT at line add (M7v, A68).** — left open by the menus plan. Asesor Q26 (the rate on the day of
  issue) is open. The till computes a basket VAT split (`vatBreakdown`,
  `apps/till/src/state/working-order.ts`) that no screen shows.
  [Detail](backlog/fiscal.md#vat-at-line-add-m7v-a68)

- **A802 — correct part of a paid invoice: build the approved design.** Nothing in the
  product can issue a corrective invoice (R5, _factura rectificativa_) for part of an issued
  simplified invoice: the engine exists and only the whole-order cancel uses it.
  Follow the [build plan](superpowers/plans/2026-10-22-a802-partial-paid-invoice-correction.md),
  including its separate protected-writer approval and exact-gross qualification. The fiscal PR
  waits for the owner to land it.
  [Detail](backlog/fiscal.md#nothing-in-the-product-can-issue-a-corrective-invoice-r5-_factura-rectificativa_-for-a-vat-error-on-an-issued-simplified-invoice)

- **Correct VAT without returning money.** Design the separate correction for a wrong VAT rate
  or classification when the customer's gross total stays the same. The owner left this out of
  A802's money-back scope on 2026-10-21; no build is approved.
  [Detail](backlog/fiscal.md#correct-vat-without-returning-money)

- **"No tax (0%)" is an open fiscal question, and it must be answered before the first live
  filing.** The 2026-10-09 research found the only 0% rate in the VAT Law is art. 91.Cuatro, goods
  donated to non-profits; the 0% on basic foods ended on 30 September 2024. The advisor is asked only
  to confirm (review item [R3](compliance/asesor-questions.md#the-shortened-list-2026-10-09)).
  **Non-blocking while pre-production; blocking before going live.**
  [Detail](backlog/fiscal.md#no-tax-0-is-an-open-fiscal-question-and-it-must-be-answered-before-the-first-live-filing)

- **Rename the `hour-*` names to minute names** — left by A947 slice 4a, which made every
  installation code a UTC minute but kept the `packages/fiscal-verifactu/src/hour-*.ts` file names,
  their identifiers, the `source: "hour"` label the allocations carry, and test titles that still
  say "hour" for what is now a minute (for example "same-hour code", "burns the entire hour"). Before go-live it needs
  no compatibility code: until then any installation may be reset (CLAUDE.md §3).

- **Should `packages/fiscal-verifactu` have a mutation floor?** It has no Stryker config, so the
  minute-name rules A947 slice 4a added are covered by tests and hand-run deletions only (the
  plan's Mutation section lists them). Decide whether it joins the mutation-tested packages.

- **A679's internet time reading came back unavailable against pre-production in each of four runs
  on 2026-10-23.** Found while planning A798-B slice 9.
  [Detail](backlog/fiscal.md#a679s-internet-time-reading-came-back-unavailable-against-pre-production-in-each-of-four-runs-on-2026-10-23)

### The setup wizard, onboarding and the demo venue

- **A1089: setup and backup recovery must distinguish waiting from missing capability.** Separate absent callbacks/services and incompatible or refused retained artifacts from temporary work; offer a supported source, image or recovery choice and any required sign-in there.
  [Audit](backlog/self-service-refusals.md#setup-readiness).

- **A1089: an incomplete-join reset needs an outcome after a failed restart.** Retain authenticated reset proof and add a supported way to retry or restart if the half-join remains.
  [Audit](backlog/self-service-refusals.md#setup-reset).

- **A1089: a different-environment partial setup needs an applicable fresh-start route.** Distinguish this from the authenticated half-adopt reset. Establish the safe fresh-server/reinstall action before offering it.
  [Audit](backlog/self-service-refusals.md#setup-environment).

- **A1089: setup state refusals need a usable resume or recovery route.** Recheck A1042 S7l on main first. Handle retained-operation mismatch and damaged setup without directing the owner to support; keep operation ownership and fiscal evidence.
  [Audit](backlog/self-service-refusals.md#setup-state).

_Formerly A2 and B1._ Detail: [backlog/setup.md](backlog/setup.md).

- **Loose ends left by A496 (moving to a new tax ID).**
  [Detail](backlog/setup.md#loose-ends-left-by-a496-moving-to-a-new-tax-id)

- **Owner decision: should a setup request stop re-checking every old "start again" archive in
  full?** Each request reads and checks every archived file of every retirement, and the retired
  workspace, so its cost grows with each retirement. Both ways to stop it weaken the check. Left
  open by A1037. [Detail](backlog/setup.md#owner-decision-should-a-setup-request-stop-re-checking-every-old-start-again-archive-in-full)

- **Bound certificate password-derivation work before opening a file.** PKCS#12 files choose their
  own derivation cost; setup and certificate renewal currently pass it to the synchronous opener.
  Scope a shared limit or an isolated opener with a deadline. Raised by A852's review.

- **`#onGoto` in `setup-app.ts` keeps `fiscalTestStatus`** — found by #567 while pruning comments.
  Several small wizard leftovers remain.
  [Detail](backlog/setup.md#ongoto-in-setup-appts-keeps-fiscalteststatus)

- **Loose ends left by SQLite slice 2 Task 9c (#646, "Restore from my bucket" in the setup
  wizard).**
  [Detail](backlog/setup.md#loose-ends-left-by-sqlite-slice-2-task-9c-646-restore-from-my-bucket-in-the-setup-wizard)

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

- **Open owner call — setup always stores a language on the account.** Keep this, or store a
  language only when the browser asked for one?
  [Detail](backlog/setup.md#open-owner-call--setup-always-stores-a-language-on-the-account)

- **The configuration preview names what it will copy by database table** — left open by C42
  (#837). Give them operator words, grouped, or keep the table names.
  [Detail](backlog/setup.md#the-configuration-preview-names-what-it-will-copy-by-database-table)

- **The Cloud restore screen shows capture and expiry times as the server's raw ISO text** in both
  languages. Left open by C42 (#837).

- **Loose ends left by #334.**
  [Detail](backlog/setup.md#loose-ends-left-by-334)

- **A fiscal test or a provision that answers after the wizard has been removed from the page
  leaves it stuck when it is put back** — found while bringing `apps/setup` to the coverage bar
  (2026-09-23), left unfixed.
  [Detail](backlog/setup.md#a-fiscal-test-or-a-provision-that-answers-after-the-wizard-has-been-removed-from-the-page-leaves-it-stuck-when-it-is-put-back)

- **Loose ends left by C47s (#840): Demo gaps on the setup wizard's venue screen, left unfixed.**
  [Detail](backlog/setup.md#loose-ends-left-by-c47s-840-demo-gaps-on-the-setup-wizards-venue-screen-left-unfixed)

- **A missing configuration export on the setup wizard's live-source screen gets no red ring.** The
  backup restore screen's file input draws one (A523); `live-source-screen.ts` marks its file input
  `aria-invalid` but has no style for it.

- **A venue's time zone must come from its country pack's list (A166, owner 2026-10-01)** — OPEN.
  **Wanted:** each country pack lists the zones it allows (Spain: Madrid and Canary), and
  creation/provisioning writers refuse a zone not on its country's list.
  [Detail](backlog/setup.md#a-venues-time-zone-must-come-from-its-country-packs-list-a166-owner-2026-10-01)

- **Remaining "?" buttons that should be hints (A237, owner 2026-10-03)** — OPEN. Other screens'
  "?" buttons were not reviewed against the rule.
  [Detail](backlog/setup.md#remaining--buttons-that-should-be-hints-a237-owner-2026-10-03)

- **No test covers the setup review screen's value cell's own centring** — left open by A243
  (W33, #1143).
  [Detail](backlog/setup.md#no-test-covers-the-setup-review-screens-value-cells-own-centring)

- **The demo venue's departments' internal names still follow the seed language.** Left open by
  W108 (#1276, the demo venue's names and tax ID come from the country pack).

- **Still open from W109-5's Barcelona look (2026-10-07):** product groups and prep stations
  stay English under Spanish staff-facing dish names (the plan's known limit).

- **The demo’s Catalan and Galician text needs a speaker’s check** (W109-3, #1321,
  owner decision 4, 2026-10-06). A speaker of each
  should read it. The demo's Drinks section labels in Catalan and Galician are drafts awaiting the
  same check, left open by A321 (the demo's included Drinks menu opens onto four sections).
  [Detail](backlog/setup.md#the-demo-data-carries-catalan-and-galician-text-w109-3-1321-task-3-of-the-same-plan--done-the-text-is-unchecked-by-a-speaker-owner-decision-4-2026-10-06--open)

- **A guided tutorial for Demo and Preparation (A250, owner 2026-10-03)** — OPEN, partly designed,
  not to be built yet (owner: "we just mustn't forget it"); needs a spec before queueing.
  [Detail](backlog/setup.md#a-guided-tutorial-for-demo-and-preparation-a250-owner-2026-10-03)

- What A2's rework left as constraints on the next change to the wizard is under [Setup wizard — the
  constraints A2's rework left
  behind](backlog/setup.md#setup-wizard--the-constraints-a2s-rework-left-behind-a2).

- **The till's "This device hasn't trusted the till yet" page has never been seen on a real
  device.** **Next action:** during the on-device trust rows above, click past the certificate
  warning on one device and confirm the page appears in the browser's preferred supported
  language, falling back to English when none is supported.
  [Detail](backlog/setup.md#the-tills-this-device-hasnt-trusted-the-till-yet-page-has-never-been-seen-on-a-real-device)

- **`pnpm dev:reset` deletes the venue folder before it refuses `WAITRON_ENV=production`.**
  `apps/server/scripts/dev-setup.ts`'s `main()` calls `resetVenueDir` under `--reset` before
  `devSetup` reaches `demoSeedEnvironment`, against the file's header. Fix: the same check at the
  top of `main()` that `dev-onboard.ts` has. Found by A680.

- **Loose ends left by A680 (#1718).**
  [Detail](backlog/setup.md#loose-ends-left-by-a680-1718)

- **A fresh Demo venue opens its dashboard on a red tax-filing alert** (`fiscal.submission_delayed`
  over the demo seed's back-dated sales). Found by A680.
  [Detail](backlog/setup.md#a-fresh-demo-venue-opens-its-dashboard-on-a-red-tax-filing-alert)

### Menus and the catalogue

- **A1075. On the Courses page the row dividers stop short of the card's sides** (mock-up 02 runs
  them to the edge; needs `course-list.ts` styles), and an error under the list would sit on the
  card's bottom border (read from the code, not seen). Left open by #1854, A756.

- **Menu prices' narrow-layout CI failure still needs a cause (A613).**
  [Detail](backlog/ci.md#menu-prices-narrow-layout-ci-failure-still-needs-a-cause-a613)

- **Modifiers' Spanish "Opciones" tab was cut at a 310 px screen on CI's Linux fonts**. The owner
  has not ruled on Modifiers; reproduce with the Linux fonts before choosing a change.
  [Detail](backlog/catalogue.md#modifiers-spanish-opciones-tab-was-cut-at-a-310-px-screen-on-cis-linux-fonts)

- **A884. Deleting an options or extras list leaves it on the published menus until they are
  republished.**
  [Detail](backlog/catalogue.md#a884-deleting-an-options-or-extras-list-leaves-it-on-the-published-menus-until-they-are-republished)

- **A885. Say that lines already on an open order keep their VAT class after a republish.**
  [Detail](backlog/catalogue.md#a885-say-that-lines-already-on-an-open-order-keep-their-vat-class-after-a-republish)

- **Repeated allergen kinds from direct callers.** The allergen validator accepts, for example,
  `{ gluten: { kinds: ["wheat", "wheat"] } }`; the dashboard picker and published derivation remove
  repeats. A668-1's Claude probe recorded that result. Decide whether direct declarations should
  be refused or normalised, then check both ingredient and product requests with repeated kinds.

- **A670 — printed menus (owner, 2026-10-14; open, not designed).** A printed menu carries each
  dish's allergen icons after its name and a key on the page naming every icon.
  [Detail](backlog/catalogue.md#a670--printed-menus-owner-2026-10-14-open-not-designed)

- **The products' made-at read has no screen since A655**
  [Detail](backlog/catalogue.md#the-products-made-at-read-has-no-screen-since-a655)

- **The data table's columns button has no tooltip**
  [Detail](backlog/catalogue.md#the-data-tables-columns-button-has-no-tooltip)

- **A product in more than one category (owner 2026-10-10, A461 amendment 4).** Define the
  storage, editor and what Move/Remove do to memberships. Products currently has one category;
  A461 shows existing placements only. This work is not queued.

- **The Products tree's hidden counts may be placed against the page at narrow width** — not measured; left open by A453.
  [Detail](backlog/catalogue.md#the-products-trees-hidden-counts-may-be-placed-against-the-page-at-narrow-width)

- **On a phone, sections nested more than four deep read flat in the Structure tab**
  [Detail](backlog/catalogue.md#on-a-phone-sections-nested-more-than-four-deep-read-flat-in-the-structure-tab)

- **Menu-root enabled-language fallback when content languages are unset (A420 review).**
  [Detail](backlog/catalogue.md#menu-root-enabled-language-fallback-when-content-languages-are-unset-a420-review)

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
  write lock** — OPEN (found 2026-09-23, task F1's review wave).
  [Detail](backlog/catalogue.md#the-media-library-still-reads-every-matching-image-for-search-and-name-sorting-inside-the-venue-write-lock)

- **A negative catalogue price can still be stored by a direct call** — OPEN (left by #487).
  [Detail](backlog/catalogue.md#a-negative-catalogue-price-can-still-be-stored-by-a-direct-call)

- **Two price rules disagree about a value that is not negative** — OPEN (found 2026-09-21, task
  N4).
  [Detail](backlog/catalogue.md#two-price-rules-disagree-about-a-value-that-is-not-negative)

- **A case the content-language decisions leave open, built with the plan's default unless the owner
  says otherwise**: receipts outside Catalonia stay free, Spanish by default.
  [Detail](backlog/catalogue.md#a-case-the-content-language-decisions-leave-open-built-with-the-plans-default-unless-the-owner-says-otherwise)

- **Loose ends left by W87 (#1191).**
  [Detail](backlog/catalogue.md#menus-list-changes-column-and-top-aligned-rows-w87-1191-left-open)

- **A menu's Structure tab is one tree (W88, #1209): not checked**
  [Detail](backlog/catalogue.md#a-menus-structure-tab-is-one-tree-w88-1209-not-checked)

- **A547 — Preview tab: "Publish later" sits to the left of "Publish now", and "Scheduled versions"
  shows only when something is scheduled** (owner, 2026-10-12). Wanted: the two buttons on one
  line, Publish later first; the heading and table drawn only while at least one version is queued.
  [Detail](backlog/catalogue.md#a547--preview-tab-publish-later-sits-to-the-left-of-publish-now-and-scheduled-versions-shows-only-when-something-is-scheduled)

- **Loose ends left by W89 (#1239).** Not checked: the Price overrides tab on the running dev stack
  — a real save and the re-read after it, and Undo against the real server (the look in Chromium
  used mounted widgets only).
  [Detail](backlog/catalogue.md#a-menus-prices-are-one-editable-price-overrides-field-per-row-w89-1239-left-open)

- **Loose ends left by W92 (#1250).** In the Structure tree, closing the section form opened from a
  section's swatch puts focus on the row's ⋮ menu rather than back on the swatch that opened it. No
  test pins it.
  [Detail](backlog/catalogue.md#a-product-has-one-colour-everywhere-w92-1250-left-open)

- **A339 test-fixture follow-up:** `apps/dashboard/src/api/menu-read-controller.test.ts` and
  `live-queries.test.ts` still use handheld five/six in fake snapshots, including three distinct
  snapshots in the invalidation cases.
  [Detail](backlog/catalogue.md#each-menu-has-one-device-home-page-w93-1287-left-open)

- **The Home page tab's Till preview draws the menu at the frame's full width, but on a real till
  the menu shares the screen with the order**
  [Detail](backlog/catalogue.md#each-menu-has-one-device-home-page-w93-1287-left-open)

- **A Home page tab product shortcut reached only through a disabled included menu reads "Not
  shown: not on sale on this menu"**, where a section shortcut in that place reads "Not shown: in a
  disabled included menu" (`#hiddenReason`, `apps/dashboard/src/widgets/device-home-preview.ts`).
  Left open by A816 (#1880).

- **A Home page shortcut's bin button stays live while a shortcut reorder or a display setting is
  being saved.**
  [Detail](backlog/catalogue.md#a-home-page-shortcuts-bin-button-stays-live-while-a-shortcut-reorder-or-a-display-setting-is-being-saved)

- **A switched-off menu's Home page tab would give every hidden shortcut the wrong reason**
  [Detail](backlog/catalogue.md#a-switched-off-menus-home-page-tab-would-give-every-hidden-shortcut-the-wrong-reason)

- **The Structure tab's "Edit section" form may stay open when another menu is opened.** Not tried: whether the form stays open, and whether saving it then writes the first menu's section.
  [Detail](backlog/catalogue.md#the-structure-tabs-edit-section-form-may-stay-open-when-another-menu-is-opened)

- **Configuration export/import still leaves publications behind.** Reset the venue instead of
  republishing old menus. Left open by A291 (2026-10-06, removed format-2 preview/republication).
  [Detail](backlog/catalogue.md#each-menu-has-one-device-home-page-w93-1287-left-open)

- **The dashboard's Home page preview (`apps/dashboard/src/widgets/device-home-preview.ts`) is a
  hand copy of the till's menu browser**
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

- **"Open <menu>" in an included menu's ⋮ can be followed while the tree is busy — OPEN (W88).**
  [Detail](backlog/catalogue.md#open-menu-in-an-included-menus--can-be-followed-while-the-tree-is-busy--open-w88)

- **Loose ends left by A322 (#1372, an included menu can show its sections directly).** A folder's
  fixed photo shows on the till only in Thumbnails mode, as a section's photo does.
  [Detail](backlog/catalogue.md#an-included-menu-can-show-its-sections-directly-a322-1372-left-open)

- **Loose ends left by A380 (#1385).** A configuration import stores a fixed folder name as given,
  spaces included, where a save through the dialog or the route trims it.
  [Detail](backlog/catalogue.md#loose-ends-left-by-a380-1385)

- **Loose ends left by W83 (#1193).**
  [Detail](backlog/catalogue.md#products-filters-and-select-at-the-start-of-the-tables-toolbar-w83-1193-left-open)

- **Not covered by W85b: while a category is being renamed, its count and asterisk follow the name
  box and are not capped.** Left open by W85b (#1243).
  [Detail](backlog/catalogue.md#products-at-phone-width-a-long-name-runs-under-the-pinned-actions-column-w85b-w85c-w85e-left-open)

- **Products at phone width: what W85e left for the owner**
  [Detail](backlog/catalogue.md#products-at-phone-width-a-long-name-runs-under-the-pinned-actions-column-w85b-w85c-w85e-left-open)

- **Catalogue names (W72): there is no unique index, and no backfill.**
  [Detail](backlog/catalogue.md#catalogue-no-two-categories-with-one-parent-and-no-two-active-products-share-a-name-w72-to-w72h-left-open)

- **A person who may not read routing sees the "Kitchen routing unavailable" line above the
  Products list, which tells them to try again later**, because a refused read counts as a failed
  one, and trying again changes nothing for them. Left open by W86 (#1203) and A655.

- **One writer still skips the required-language check (`content.language_required`) — OPEN.**
  The Prepare-to-Live configuration copy (`packages/catalogue/src/configuration-transfer.ts`)
  copies the saved row as it is, unplanned. The demo seed
  (`apps/server/scripts/demo-seed/seed-catalogue.ts`) runs the check since W109-4 (#1322).

- **Translate all: an Edit translations dialog left open anywhere clears the "Translations ready"
  notice.**
  [Detail](backlog/catalogue.md#translate-all-an-edit-translations-dialog-left-open-anywhere-clears-the-translations-ready-notice)

- **Cloud services shows Translate all only from the second status check after connecting.** The
  first Refresh status is a lease renewal, and only a configuration request asks for services
  version 2 (`apps/server/src/cloud-installation.ts`). Seen in the Santet run (A689-21).

- **Translate all: shared collect-page test vectors.** Nothing compares the fake Cloud's paging
  (`apps/server/test/translation-cloud-fixture.ts`) with Cloud's own; vectors Cloud generates and
  both sides check would catch drift in CI. A contract change for Cloud's side.
  [Detail](backlog/catalogue.md#translate-all-shared-collect-page-test-vectors)

- **Translate all: a job that ends before any item is accounted for does not count its items as
  lost.**
  [Detail](backlog/catalogue.md#translate-all-a-job-that-ends-before-any-item-is-accounted-for-does-not-count-its-items-as-lost)

- **Loose ends left by A689's fifth PR.**
  - Alert wording writes numbers without a thousands separator (`formatParam`,
    `packages/dashboard-kit/src/alert-messages.ts`); the Translate all notice reads "1050
    suggestions".

- **Translate all: a venue with more than Cloud's 20 content languages gets a job Cloud refuses.**
  The box saves up to 200 languages and sends them all as `languages.enabled`; Cloud refuses every
  job past 20 with 400, which reaches the dialog as `cloud.request_invalid` (ruling W1b, A689's
  second PR). A box-side refusal before any job is built would say what is wrong.

- **Translate all: a job the box ends itself is marked released without a call to Cloud, and Cloud
  can still hold it.**
  [Detail](backlog/catalogue.md#translate-all-a-job-the-box-ends-itself-is-marked-released-without-a-call-to-cloud-and-cloud-can-still-hold-it)

- **Translate all: open points from the review of A689's second PR.**
  [Detail](backlog/catalogue.md#translate-all-open-points-from-the-review-of-a689s-second-pr)

- **Translate all: the notice's count can be higher than what the dialog shows.** `waiting`
  (`readSuggestionRun`, `packages/catalogue/src/content-suggestion-jobs.ts`) counts every stored
  suggestion with text, including out-of-date ones, ones for deleted items or switched-off languages,
  and ones left from an earlier run. Opening the dialog clears the notice, which limits the effect.

- **Translate all: three limits the translations dialog accepts for now (A689's fourth PR,
  2026-10-15).**
  [Detail](backlog/catalogue.md#translate-all-three-limits-the-translations-dialog-accepts-for-now-a689s-fourth-pr-2026-10-15)

- **`joinCustomerPresentationText` passes the requested language where the default belongs — OPEN
  (found 2026-10-02 by A172, not measured).**
  [Detail](backlog/catalogue.md#joincustomerpresentationtext-passes-the-requested-language-where-the-default-belongs--open-found-2026-10-02-by-a172-not-measured)

- **Language resolution follow-ons** — there is still no single shared rule: the receipt's
  `lineName` (`apps/server/src/receipt-document.ts`) and the kitchen ticket's `ticketName`
  (`apps/server/src/kitchen-print.ts`) try the exact language and then take the first stored one.
  [Detail](backlog/catalogue.md#language-resolution-follow-ons)

- **Product folders, menus that include menus, and prep station routing: partly built (design
  approved 2026-09-30).**
  [Detail](backlog/catalogue.md#product-folders-menus-that-include-menus-and-prep-station-routing-partly-built-design-approved-2026-09-30)

- **Sales classification and the menus plan — what they left open.** `Product.categoryId` and
  `primaryCategoryId` always hold the same value.
  [Detail](backlog/catalogue.md#sales-classification-and-the-menus-plan--what-they-left-open)

- **Content languages and the image library (#339, #344) — what is left open.**
  [Detail](backlog/catalogue.md#content-languages-and-the-image-library-339-344--what-is-left-open)

- **The upload limit is 20 MB (owner decision 2026-09-23).** It bounds how large an upload the
  server will buffer; the decode is bounded by `MAX_INPUT_PIXELS` (100 million). What current
  phones produce has not been measured. Left open by photos shrunk on upload (#543).

- **Category authoring serialises across the whole database, and nobody has measured what that
  costs.**
  [Detail](backlog/catalogue.md#category-authoring-serialises-across-the-whole-database-and-nobody-has-measured-what-that-costs)

- **Extras and Options — deliberate limits, and what is left open.**
  [integration contract](developers/modifiers.md).
  [Detail](backlog/catalogue.md#extras-and-options--deliberate-limits-and-what-is-left-open)

- **Image library (#547's review, `packages/media/src/dashboard/image-library.ts` and
  `image-picker.ts`).**
  [Detail](backlog/catalogue.md#image-library-547s-review-packagesmediasrcdashboardimage-libraryts-and-image-pickerts)

- **The Price heading reads "Price per portion" also over a row sold by the unit.** Still open from
  its review: neither screen counts a stored unit seeded as `each` as Each, which `isEachUnit`
  (`packages/catalogue/src/units.ts`) does; no code outside tests seeds one. Left open by W75 (the
  Extras editor shows Portion beside Price, #1194).

- **A name stored under a regional code such as `en-GB` is read by the forms as the plain code
  first, then its regional ones**
  [Detail](backlog/catalogue.md#a-name-stored-under-a-regional-code-such-as-en-gb-is-read-by-the-forms-as-the-plain-code-first-then-its-regional-ones)

- **At phone width in a right-to-left layout, a long name in the Products list can run under the
  pinned Actions column**
  [Detail](backlog/catalogue.md#at-phone-width-in-a-right-to-left-layout-a-long-name-in-the-products-list-can-run-under-the-pinned-actions-column)

- **Loose ends left by A343 (a menu's Price overrides tab tidied, #1368).** The Price overrides
  tab's save message comes after the whole table in tab order, so a keyboard user cannot reach Undo
  from a field within its 5 seconds (decided as built, not tested with a user).
  [Detail](backlog/catalogue.md#loose-ends-left-by-a343-a-menus-price-overrides-tab-tidied-1368)

- **A353 — Preview's changes: an "Undo" link that puts one change back to the live version** —
  owner, 2026-10-07; PARKED, not queued — owner 2026-10-08: take it from here when a lane has room.
  [Detail](backlog/catalogue.md#a353--previews-changes-an-undo-link-that-puts-one-change-back-to-the-live-version)

- **Loose ends left by A347 (#1392).** An imported bundle may carry priced menu rows for a product
  no menu reaches, and adding the product back to a menu revives those prices (found in A347's
  review, believed to predate it).
  [Detail](backlog/catalogue.md#loose-ends-left-by-a347-1392)

- **Loose ends left by A346 + A348 (a price this menu sets stands out, an Available column, and Edit
  product, #1408).** At a 320px window only "12.50 – 15.00" was measured in a menu's Price overrides
  tab.
  [Detail](backlog/catalogue.md#loose-ends-left-by-a346--a348-a-price-this-menu-sets-stands-out-an-available-column-and-edit-product-1408)

- **The reveal fix corrects only a row left under the headings.** A row revealed at the bottom edge
  is not corrected, and by the same whole-pixel rounding it can sit up to half a pixel past the
  bottom (left alone; not measured). Left open by A294 (the Products and Structure trees show drag
  grips only in a mode, #1300).

- **Loose ends left by A263 (#1151)** — OPEN, unqueued.
  [Detail](backlog/catalogue.md#what-1151-left-open-2026-10-03)

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

- **A category's naming square does not announce the inherited colour's source.**
  [Detail](backlog/catalogue.md#a-categorys-naming-square-does-not-announce-the-inherited-colours-source)

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

- **At 390px the items table is wider than its scrolling box with or without the mark**
  [Detail](backlog/catalogue.md#at-390px-the-items-table-is-wider-than-its-scrolling-box-with-or-without-the-mark)

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

- **Loose ends left by A663 Part 2d (#1779).** The dashboard lets a manager attach an extras list to
  a product sold in a unit with decimals, on a scale or with the measure switch on, and the till
  then offers no extras for it, with no word to the manager.
  [Detail](backlog/catalogue.md#loose-ends-left-by-a663-part-2d-1779)

- **A dish in a measure unit is still rung up one unit per tap** (A821f). A 250 ml line is 1 ml per
  tap, splits into 250 lines and counts as 250 items. Whether a measure should ask its quantity as
  a decimal unit does is the owner's call.
  [Detail](backlog/catalogue.md#a-dish-in-a-measure-unit-is-still-rung-up-one-unit-per-tap)

- **The Units list does not show which units are measures** (A821f), and switching one on gives no
  warning that the dishes in that unit lose their extras lists at the next publish.

- **Customer order drafts never look at a dish's unit** (A821f): `unavailable`
  (`apps/server/src/order-drafts.ts:970`) checks an extras pick against the offer's lists only, so
  an extra on a dish sold in a measure is flagged only when the draft is priced — as for a dish
  with decimals or on a scale today. Read, not run.

- **The extras form cannot pick a variant**, though the catalogue accepts one as an extras item
  (owner decision 2026-09-24): its picker lists top-level products only (`listProducts`). **Next
  action:** decide whether the picker should list variants.

- **A configuration transfer copies `extra_list_items` as a table**, so it does not ask
  `extras.product_has_variants`; a venue holding data written before #578 would carry such an item
  across. Read, not run; nothing unless transfers from older venues matter.

- **A location's menu list is read by no sale.** **Next action:** owner to decide whether to retire
  `location_catalogues` and the management location routes.
  [Detail](backlog/catalogue.md#a-locations-menu-list-is-read-by-no-sale)

- **Two signals say whether a dish is sold by weight, and they can disagree in storage.** Since B4
  the order path reads only the unit (`priceOrderLines`), so no sale reads `products.pricing_unit`.
  **Next action:** keep it in step with the unit or drop it.
  [Detail](backlog/catalogue.md#two-signals-say-whether-a-dish-is-sold-by-weight-and-they-can-disagree-in-storage)

- **`createProduct` and `updateProduct` duplicate the legacy-`pricingUnit` fallback**, and the
  synthetic `EACH_UNIT` id is a literal in both `packages/catalogue/src/unit-validation.ts` and the
  till's `product-name.ts` with nothing pinning them equal.
  [Detail](backlog/catalogue.md#createproduct-and-updateproduct-duplicate-the-legacy-pricingunit-fallback)

- **The combined end-to-end journey has not been walked**
  [Detail](backlog/catalogue.md#the-combined-end-to-end-journey-has-not-been-walked)

- **The catalogue picker was deleted and nothing replaced it.** `selectedCatalogueId`
  (`catalogue-screen.ts`) takes the first catalogue in the list, which is also the one every new
  product is created in; with two, the second becomes unreachable from the dashboard. **Next
  action:** decide whether more than one catalogue is a case Waitron supports.

- **A product's name can be stored blank.** `products.name` is `NOT NULL` with no non-empty check,
  and only the editor's parser refuses a blank; `option_lists.name`, `option_labels.name` and
  `extra_lists.name` share the pattern (`packages/catalogue/drizzle/0000_baseline.sql`). **Next
  action:** decide whether the columns want a check constraint and the write paths a domain refusal.

- **Retire the product editor's required-translation refusal mapping.**
  [Detail](backlog/catalogue.md#retire-the-product-editors-required-translation-refusal-mapping)

- **Smaller things #379 surfaced and did not take.** The kitchen screens show a kitchen-resolved
  dish name above modifier text resolved in the device's own locale. A joined customer-facing line
  can mix languages when a locale exists on one half only.
  [Detail](backlog/catalogue.md#smaller-things-379-surfaced-and-did-not-take)

- **The kitchen and expo screens still show allergens as text chips.** A668 brings icons to the
  editor, the till's buttons and its order list, not to these screens.

- **A928. The Courses list may move its rows under a held drag (found by A758-2's review, not
  tested).**
  [Detail](backlog/catalogue.md#a928-the-courses-list-may-move-its-rows-under-a-held-drag-found-by-a758-2s-review-not-tested)

- **The picker collapses on `focusout` alone** (`#finishEditing`). If the editor is reported
  snapping shut mid-selection, make the collapse depend on `relatedTarget`.

### Service periods, opening hours and departments

- **A1070. The department dialog's Transfers panel heading is an `h2`, the dialog title's level,
  beside Service's `h3` sections** — an existing accessibility check selects `h2` (left open by
  #1852, A756).

- **A1071. Offer "At once" (0 minutes) in each department's reminder**, as A773 §3.4 decided
  (owner, 2026-10-17); the list offers Off and 5–30 minutes and the save refuses 0
  (`requireReleaseReminderMinutes`, `packages/venue-service/src/routes.ts`). Left open by A756 PR 4.

- **A1072. A chosen "Off" in the department reminder looks unset.** Off is the empty value, which
  `wt-combobox` draws as a placeholder, grey and italic, without `show-empty-option`
  (`packages/ui/src/components/wt-combobox.ts:508`, `:159-162`, `:1047`). Left open by A756 PR 4.

- **A1073. Saving one field in the department dialog can undo another manager's change to a
  different field.** [Detail](backlog/service-periods.md#a1073-saving-one-field-in-the-department-dialog-can-undo-another-managers-change-to-a-different-field)

- **A1074. A configuration import does not range-check a department's reminder minutes**, so a
  file could store 0, a negative number or 999; only the department save refuses them. Left open
  by A756 PR 4's review (#2020).

- **A1083. The department delete preview says "Removes 1 floor plan sets."**
  [Detail](backlog/service-periods.md#a1083-the-department-delete-preview-says-removes-1-floor-plan-sets)

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

- **A season reads two shades of its colour**
  [Detail](backlog/service-periods.md#a-season-reads-two-shades-of-its-colour)

- **At phone width the Seasons window cuts longer colour names**
  [Detail](backlog/service-periods.md#at-phone-width-the-seasons-window-cuts-longer-colour-names)

- **At 390 px the Seasons window's month picker runs off the right edge.**
  [Detail](backlog/service-periods.md#at-390-px-the-seasons-windows-month-picker-runs-off-the-right-edge)

- **The Periods window: two looks from A719's LOOK (#1838).** At 390 px a period's swatch beside a
  name that wraps shrinks to 14.4 px wide (the others are 16 px); at 1280 px the window is full
  height with about 300 px blank above Close, because it is the unsized `wt-modal`. Both measured
  on the demo venue (`~/waitron-campaign/a719-look-report.md`, C2 and C4). Left open by A719.

- **The special-day painter does not say a deleted period's replacement is still missing after a
  failed re-read.** When a period is deleted in the Periods window over the painter and the
  painter's re-read of the day fails, nothing tells the manager until Save shows "could not save"
  (finish-branch's account of its own fix on #1838; not re-run since). Left open by A719.

- **A per-field department policy repair changes the trading-name default.**
  [Detail](backlog/service-periods.md#a-per-field-department-policy-repair-changes-the-trading-name-default)

- **A855. The till's zones read builds date formatters on every call (2026-10-18).**
  [Detail](backlog/service-periods.md#a855-the-tills-zones-read-builds-date-formatters-on-every-call)

- **The Month's year link: its focus ring nearly touches the month's name.** The ring sits in the
  space before the year ("September[2026]"), readable but tight (A759's look, #1812). A margin on
  the link must also go on the hidden width copies in `fixed-title.ts`, or the arrows move again.
  Left open by A759.

- **Loose ends left by A755 (#1809).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a755-1809)

- **Loose ends left by A788 (the business-day start changes at the next changeover).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a788)

- **Eleven `receipts.*` strings in `apps/dashboard/src/i18n/strings.ts` have no reader** — found
  while doing A755 (#1809); none had one before it either: `departments_zones`,
  `language_copies`, `language_receipts`, `language_save_error`, `not_printed`, `preview_for`,
  `preview_paper`, `trading_name_location`, `trim_save_error`, `venue_defaults` and `venue_wide`.

- **Loose ends left by A720.**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a720)

- **A server write that changes a department's hours leaves its zones' closures outside them**
  [Detail](backlog/service-periods.md#a-server-write-that-changes-a-departments-hours-leaves-its-zones-closures-outside-them)

- **The zone-closure hours check runs at the routes, not inside the writers**
  [Detail](backlog/service-periods.md#the-zone-closure-hours-check-runs-at-the-routes-not-inside-the-writers)

- **Unticking a special date's "Closed all day" brings back its zone paint unchecked**
  [Detail](backlog/service-periods.md#unticking-a-special-dates-closed-all-day-brings-back-its-zone-paint-unchecked)

- **A change to a department's season week can leave a special date's zone closure outside its
  new hours**
  [Detail](backlog/service-periods.md#a-change-to-a-departments-season-week-can-leave-a-special-dates-zone-closure-outside-its-new-hours)

- **A yearly special day's zone paint is checked against its stored date only**
  [Detail](backlog/service-periods.md#a-yearly-special-days-zone-paint-is-checked-against-its-stored-date-only)

- **`opening.follow_week` and `menu.normal_week` have no reader** — found during A723 (#1849); it
  predates A723. Both strings, English and Spanish, are in
  `packages/venue-service/src/dashboard/strings.ts` and nothing reads them; delete them or use them.

- **A special day whose dates have different changeovers is cut on the first date's changeover**
  [Detail](backlog/service-periods.md#a-special-day-whose-dates-have-different-changeovers-is-cut-on-the-first-dates-changeover)

- **The season-week and closed-week routes do not lower-case a zone or season id, as the
  special-day route does**
  [Detail](backlog/service-periods.md#the-season-week-and-closed-week-routes-do-not-lower-case-a-zone-or-season-id-as-the-special-day-route-does)

- **A cut-away zone stroke hides another day's refusal marker until the next Save**
  [Detail](backlog/service-periods.md#a-cut-away-zone-stroke-hides-another-days-refusal-marker-until-the-next-save)

- **A season closure on a special date is not cut or checked against that date's shorter hours**
  [Detail](backlog/service-periods.md#a-season-closure-on-a-special-date-is-not-cut-or-checked-against-that-dates-shorter-hours)

- **A723's plan defaults sent to the owner as an FYI**
  [Detail](backlog/service-periods.md#a723s-plan-defaults-sent-to-the-owner-as-an-fyi)

- **A762's plan defaults sent to the owner as an FYI**
  [Detail](backlog/service-periods.md#a762s-plan-defaults-sent-to-the-owner-as-an-fyi)

- **A purple season looks like a special day**
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
  [Detail](backlog/service-periods.md#the-business-day-start-dialog-repeats-the-servers-conflict-counting-rule)

- **Loose ends left by A506-4 (#1597).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a506-4-1597)

- **A department or zone delete's preview never counts a special day's painted hours**
  [Detail](backlog/service-periods.md#a-department-or-zone-deletes-preview-never-counts-a-special-days-painted-hours)

- **Loose ends left by A577 (#1702).**
  [Detail](backlog/service-periods.md#loose-ends-left-by-a577-1702)

- **The readiness line for a repeating holiday date names the official holiday**
  [Detail](backlog/service-periods.md#the-readiness-line-for-a-repeating-holiday-date-names-the-official-holiday)

- **Once a stored holiday date's year has passed, each order's service-state read
  (`readServiceDayPlan`) also reads the tenant, location and holiday area** to find that year's
  holiday: about 100 µs of roughly 860 µs per call, measured over 2000 calls on a Madrid test venue.
  A cache that outlives the transaction is one way to remove it — left open by A506-5, #1603.

- **The "Add to" offer reads every special day with every date** (`GET …/special-days`) to show a
  name and a latest date — left open by A506-5, #1603.

- **The start-time part of the business-day check's `transition_strip` reason never decides it**
  (`inStrip(minutes(startsAt))`, `business-day-schedule.ts`): `endpoint_day` wins first, and a
  mutation deleting it left 95 of 95 tests passing. Delete it or give it a case that needs it — left
  open by A789 slice 1, #1948.

- **A1084. A confirmed late dish routes by the period running when it is sent, not the period the
  kitchen agreed for**
  [Detail](backlog/service-periods.md#a1084-a-confirmed-late-dish-routes-by-the-period-running-when-it-is-sent-not-the-period-the-kitchen-agreed-for)

- **A1085. Extras added later to a dish sent after its period carry no mark.** An extras-only edit
  or a recalled dish's added extras are priced as `ADDED_EXTRAS_ONLY` and skip the late check
  (`priceOrderLines`, `apps/server/src/working-order.ts`), so such an extra made at its own station
  prints and shows unmarked. Left open by A789 slice 3, #2051 (plan D25).

- **A1090. The zone Keep open's manager's PIN dialog, closed while its PIN is checked, can leave
  the zone's Keep open dialog stuck.**
  Read in the code, not run. Left open by A789 slice 4.
  [Detail](backlog/service-periods.md#a1090-the-zone-keep-opens-managers-pin-dialog-closed-while-its-pin-is-checked-can-leave-the-zones-keep-open-dialog-stuck)

- **A1091. The late-send window and its manager's PIN dialog stay open when the waiter changes table
  without signing out**
  [Detail](backlog/service-periods.md#a1091-the-late-send-window-and-its-managers-pin-dialog-stay-open-when-the-waiter-changes-table-without-signing-out)

- **A1095. The till's refusal "A dish's period has ended." names no next step**
  [Detail](backlog/service-periods.md#a1095-the-tills-refusal-a-dishs-period-has-ended-names-no-next-step)

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

- **A date another manager removed stays in the special-day draft**
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

- **Cosmetic points from A722 Part 3's look, #1834:**
  [Detail](backlog/service-periods.md#cosmetic-points-from-a722-part-3s-look-1834)

- **The painter cannot resize a block by dragging its edge**; painting over a block lengthens it
  and painting Closed shortens it — left open by A506-8, #1634.

- **Painting stops short of an off-quarter-hour changeover**
  [Detail](backlog/service-periods.md#painting-stops-short-of-an-off-quarter-hour-changeover)

- **A season painter save writes each edited week whole**
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

- **Two date helpers read years 0 to 99 as 1900 to 1999**
  [Detail](backlog/service-periods.md#two-date-helpers-read-years-0-to-99-as-1900-to-1999)

- **Two holidays with one name in one year's list**
  [Detail](backlog/service-periods.md#two-holidays-with-one-name-in-one-years-list)

- **Re-check that each Departments screen recovery case fails when its recovery step is deleted.**
  An unresolved assertion finding from A366 slice 6 Part C (#1510); A493 relocated its owner.

- **A897. Sales by department**
  [Detail](backlog/service-periods.md#a897-sales-by-department)

- **Refresh service settings on an open till**
  [Detail](backlog/service-periods.md#refresh-service-settings-on-an-open-till)

- **Concurrent department settings edits** — decide whether two managers editing the same
  department need stale-write protection. The form sends its whole draft; a runtime overlap
  probe remains to be run before choosing a conflict policy.

- **Split an order's recorded service mode into two facts (owner, 2026-10-09) — future work.**
  [Detail](backlog/service-periods.md#split-an-orders-recorded-service-mode-into-two-facts)

- **Compare computed station weeks with live routing on a painted special-day date without zone paint.**
  The slice 4 review read the planning and zone-week paths but did not compare the real sale
  resolver. Add a real-database comparison before claiming they agree on that case.

- **Who authorised today's station or zone change**
  [Detail](backlog/service-periods.md#who-authorised-todays-station-or-zone-change)

- **Departments, service styles and opening hours (A254, owner 2026-10-03) — residuals.**
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

- **Smaller notes from the public holidays reviews**
  Left open by A261 step 6 (Public holidays, #1305).
  [Detail](backlog/service-periods.md#smaller-notes-from-the-public-holidays-reviews)

### The kitchen and preparation

_Formerly the kitchen entries in the opening part of the old Track A (before A1), and kitchen entries elsewhere; part of A9._ Detail: [backlog/kitchen.md](backlog/kitchen.md).

- **A1006. A dish or station name holding `$&` or `$'` is garbled in the kitchen's cross-references.**
  [Detail](backlog/kitchen.md#a1006-a-dish-or-station-name-holding--or--is-garbled-in-the-kitchens-cross-references)

- **A1059. Add station and the station editor draw the late flags differently.** Add draws three
  full-width fields ("Warm after (min)" and so on); the editor one short row under "Late flags
  (minutes)" (`prep-stations-screen.ts` `#dialog`, `station-editor.ts`). The owner's one-row
  decision (A725) names the editor; ask whether Add should match. Left open by A756 PR 5.

- **A1060. Ask whether A773's picture 10 replaces the station's three late-flag fields** with its
  one "Late after · 5 · 10 · 15 min" dropdown; A756 PR 5 kept A725's three (owner, 2026-10-15).

- **A1061. At 1280 px the station editor's late-flags row and held-work note are wider than its fields**
  [Detail](backlog/kitchen.md#a1061-at-1280-px-the-station-editors-late-flags-row-and-held-work-note-are-wider-than-its-fields)

- **A1062. Ask whether picture 10's Held courses dropdown, "Print when sent", replaces the station
  editor's switch "Print held groups in advance"** (left open by A756 PR 6).

- **A1063. Picture 10 lists Identical dishes and Held courses above MOVED slips; the station editor
  puts them after it.** Owner FYI from A756 PR 6; say if the editor should follow the picture.

- **A1065. A printer shared by a station recorded for a held group and one not recorded prints one
  FIRE-marked ticket carrying both stations' dishes** (`apps/server/src/kitchen-print.ts:662-666`);
  ask the owner whether FIRE should mark only the recorded station's part. Left open by A756 PR 6.

- **A1066. Four server test files mark a HOLD ticket printed without recording a station.**
  [Detail](backlog/kitchen.md#a1066-four-server-test-files-mark-a-hold-ticket-printed-without-recording-a-station)

- **A1067. Owner FYI: the station editor's "Done on the screen" words.** "One item at a time" and
  "Whole ticket at once" (pictures 04 and 10; the old Kitchen tab said "Bump mode", "Per item",
  "Whole ticket"); Spanish «Marcado en la pantalla», «Un plato cada vez», «Toda la comanda a la
  vez», and the kitchen screen's «Toda la comanda». Say if other words read better (A756 PR 7).

- **A1068. Owner FYI: the station editor's "Changes after sending" words.** "Not allowed", "While
  held" and "While held or waiting"; picture 10's "(printer only)" was dropped because the middle
  value suits a printer-only station too. Spanish «Cambios tras el envío», «No permitidos», «Solo
  en espera», «En espera o sin empezar». Say if other words read better (A756 PR 8).

- **A1079. Owner question: should a supervisor see each station's "Changes after sending"?** The
  Kitchen tab let a supervisor read it (owner, 2026-10-04); since #2044 it lives only in the station
  editor, which needs `venue_service.manage`. Decide whether a supervisor gets a read-only view
  ([decision note](backlog/dashboard.md)). Left open by A756 PR 8.

- **A1080. Owner question: which refusal wins when one save holds a started dish and a dish at a "Not allowed" station.**
  [Detail](backlog/kitchen.md#a1080-owner-question-which-refusal-wins-when-one-save-holds-a-started-dish-and-a-dish-at-a-not-allowed-station)

- **A1081. Owner FYI: the till's words for `ticket.already_fired`.** Since #2044 they no longer
  blame the station, because the server sends that code in other cases too: "This item has already
  gone to the kitchen and cannot be changed. You can cancel it" («Este plato ya ha ido a cocina y no
  se puede cambiar. Puedes cancelarlo»). Say if other words read better.

- **A807. One slip per printer and one notice per station for a whole-order kitchen-note change (owner, 2026-10-17).**
  [Detail](backlog/kitchen.md#a807-one-slip-per-printer-and-one-notice-per-station-for-a-whole-order-kitchen-note-change-owner-2026-10-17)

- **Supervisors have no dashboard path to a prep station's times** (ASK A1 of A506-12).
  [Detail](backlog/kitchen.md#supervisors-have-no-dashboard-path-to-a-prep-stations-times)

- **Browser tests still read `history.length` to tell whether a push happened, and Chromium stops
  it at 50**, so past that a test cannot see a push (`git grep -l 'history\.length;' -- '*.test.ts'`,
  Prep stations' older address cases among them). Move them to `pushState`/`replaceState` spies, as
  the retired-address tests do — left open by A506-12.

- **A routing period line naming another location's period is flagged but never drawn** (left open by A455, #1492).
  [Detail](backlog/kitchen.md#a-routing-period-line-naming-another-locations-period-is-flagged-but-never-drawn)

- KDS-4 follow-up: device-mode reprint behind `requireDevice`.

- **A908. Kitchen cancellation on Record unpaid departure (left open by A758's Q43 revision, 2026-10-19).**
  [Detail](backlog/kitchen.md#a908-kitchen-cancellation-on-record-unpaid-departure-left-open-by-a758s-q43-revision-2026-10-19)

- **A930. The manager's overdue report counts a held dish as late (left open by A757 slice 3).**
  `computeOverdueOrders` (`packages/reporting/src/overdue-orders.ts`) never checks `fired_at`, so a
  dish held 20 minutes is listed Forgotten while the floor counts only fired dishes (A757 Q17).
  Decide whether the report leaves held dishes out too. [Detail](backlog/kitchen.md#a930-the-managers-overdue-report-counts-a-held-dish-as-late)

- **A808. A reprinted kitchen ticket shows when it was reprinted (owner, 2026-10-17).** The heading
  reads `*** REPRINT HH:MM ***`, the local time of the reprint, where today it reads
  `*** REPRINT ***` (`apps/server/src/kitchen-ticket.ts`); the original send time stays on the
  ticket. Done when a ticket test pins both times on one reprint.

- **A1086. On a kitchen ticket nothing marks where a run of dishes sent after their period ends.**
  The late-send mark prints only above the run (`emitGrouped`, `apps/server/src/kitchen-ticket.ts`),
  so an unmarked dish printed straight after it — a caña after the marked tortilla and entrecot —
  looks part of the marked group. Seen, 2026-10-25 (A789 slice 3's look).

- **A1087. Kitchen tickets print a whole quantity with three decimals**, such as `2.000 x CROQ
  JAMON`, and tests pin it; decide with the owner whether it prints `2 x`.
  [Detail](backlog/kitchen.md#a1087-kitchen-tickets-print-a-whole-quantity-with-three-decimals)

- **A1092. The kitchen screen once showed only some orders after a switch to Spanish.** Seen,
  2026-10-25 (A789 slice 4's look, `60` and `61` in `~/waitron-campaign-c/a789-4-shots/`): it showed
  orders #2 and #4 while the station's queue also held #1 and #7; a reload brought them back and a
  second switch did not lose them. Cause not found; that slice did not change the kitchen screen.

- **KDS operations — low priority (A9)**
  [Detail](backlog/kitchen.md#kds-operations--low-priority-a9)

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group; printing
  problems).**
  [Detail](backlog/kitchen.md#task-5-750-kitchen-pass-and-table-screen-by-group-printing-problems)

- **A809. The table screen reads its printing problems in the groups read (owner, 2026-10-17).**
  [Detail](backlog/kitchen.md#a809-the-table-screen-reads-its-printing-problems-in-the-groups-read-owner-2026-10-17)

- **Loose ends left by service Task 6 (#761, HOLD tickets in advance).**
  [Detail](backlog/kitchen.md#task-6-761-hold-tickets-in-advance)

- Left by C78's review: the earliest fire time is picked by comparing the stored times as text,
  right only while every writer stores the same `toISOString()` form.
  [Detail](backlog/kitchen.md#the-earliest-fire-time-is-picked-by-comparing-the-stored-times-as-text)

- **`GET /management-api/stations/outputs-down` and the dashboard's `listOutputsDown` have no caller**
  [Detail](backlog/kitchen.md#get-management-apistationsoutputs-down-and-the-dashboards-listoutputsdown-have-no-caller)

- **A long word in a routing-grid row name still splits at 390 px.**
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

- **The period delete warning orders its rows on the server** (`routingRowPlaces`,
  `packages/venue-service/src/menu-timetable.ts`) **with a copy of the Routes tab's row order**
  (`visibleRoutingRows`); a change to one can leave the other behind. Move the order into
  `packages/venue-service/src/routing.ts` and use it from both. Left open by A366 slice 4 Part A.

- **Routing reads do work only one screen uses** — left open by A366 slice 4 Part A's review.
  [Detail](backlog/kitchen.md#routing-reads-do-work-only-one-screen-uses)

- **A selected tab that grows while its strip keeps its width is not scrolled back into view** — left open by A487a (#1540).
  [Detail](backlog/kitchen.md#a-selected-tab-that-grows-while-its-strip-keeps-its-width-is-not-scrolled-back-into-view)

- **`PUT /management-api/stations/:sid/printers` (`apps/server/src/print-api.ts`) has no dashboard caller** since A366 slice 4 Part A
  moved a station's printers into the station save; `parseStationPrinterIds`
  (`apps/server/src/management-api.ts`) repeats its checks. Decide whether to remove the route.

- **A routing choice a refresh drops names one reason, chosen when it is dropped** — left open by
  A375 (#1382, its review, 2026-10-07): if its zone and its category both go and only the zone comes
  back, the message still names the zone; and only a returning zone or product has a test that the
  message clears — a returning category or No category row has none.

- **KDS corrections deferred from #191** — owner, 2026-09-01.
  [Detail](backlog/kitchen.md#kds-corrections-deferred-from-191)

- **Order-timing and modifier follow-ons**: delivery-order floor flash, idle-floor escalation,
  station-kind threshold defaults, an unbumped-since-fire metric; on-screen modifier `×N`, the shared
  `#allergens` render, the KDS-versus-till unreviewed-dish call, the TS-4 partial-transfer
  modifier-split guard.

- **Mark a new dish as urgent** — owner, 2026-09-27.
  [Detail](backlog/kitchen.md#mark-a-new-dish-as-urgent)

- **Three follow-ups 3c-1 left:** — left open by the product folders work.
  [Detail](backlog/kitchen.md#three-follow-ups-3c-1-left)

- **A following extra has different names on paper and on screen.** — left open by the product
  folders work.
  [Detail](backlog/kitchen.md#a-following-extra-has-different-names-on-paper-and-on-screen)

- **The dark-screen alert can be wrong** (S2b, owner, 2026-10-01).
  [Detail](backlog/kitchen.md#the-dark-screen-alert-can-be-wrong)

- **Changing sent lines and the kitchen screen (Task 7c, #710, and the kitchen fixes after it).** —
  left open by the menus plan.
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
  [Detail](backlog/kitchen.md#a694--correction-slips-do-not-print-the-partys-name-2026-10-15-open-owner-decision)

- **A695 — Naming or renaming a party after its food was sent prints nothing (2026-10-15; open,
  owner decision).**
  [Detail](backlog/kitchen.md#a695--naming-or-renaming-a-party-after-its-food-was-sent-prints-nothing)

- **A692 — Editing a sent dish decides its extras' "made here" again, by the device that edits
  (2026-10-15; open, owner decision).**
  [Detail](backlog/kitchen.md#a692--editing-a-sent-dish-decides-its-extras-made-here-again-by-the-device-that-edits)

### The till, devices and table service

- **Legacy bill moves need a source-location check.** An unpaired `POST /api/bills/:id/move`
  accepted a counter bill from another location into an answered party. The new allergy move
  command checks the source location; the legacy request still needs its own fix and regression.
  [Probe and scope](backlog/till.md#legacy-bill-moves-do-not-check-the-source-location).

- **Remove the Filter's unused session-storage write.** Filter selections live in the active
  operator's app state and reset on sign-out. `till-app.ts` writes `waitron.dietFilter` but never
  reads it; the same write-only key exists at `1f88662fb`. Remove the redundant write without
  adding cross-login restoration. Found during A738 review; retain the filter-lifetime tests.

- **A1051. Hiding a zone does not check its other tables' unsent dishes, on a till or a
  handheld.** Read, not run: `#hidesOrderZone` (`apps/till/src/till-app.ts`) checks only the counter
  basket and the open table, as since A740's #1825 (`c90856059`); ticking the zone again brings the
  dishes back. Kept as is by A797 slice 4 (its plan's D3b).

- **A1052. A handheld's transfer accept list holds only counter zones.** Read, not run: a handheld
  fills it from `GET /api/default-service-zone/offers`, whose `zones` are the profile's counter
  zones (`apps/server/src/till-api.ts`); a till's holds every profile zone. Unchanged by A797 slice
  4 (its plan's D4).

- **A1053. Two till shell cases leave the screen language as Spanish.** Read, not run: in
  `apps/till/src/widgets/till-shell.test.ts`, "shows the language's full name at 1280 wide…" never
  restores it and "updates the chooser's active language…" restores es-ES, not what it found
  (`fec3797f5`, `5c1a1c2df`). CLAUDE.md §4: such a test restores the language.

- **A1054. A Lit "change-in-update" warning in "live device zones > recovers a floor-only device
  without needing a counter poll"** (`apps/till/src/till-app-device-zones.test.ts`). The case
  passes; the build's ledger saw the warning on `dc7ac4b50`, and it prints on A797 slice 4's tip.
  What sets a property inside the update is not traced.

- **A1055. At phone width, a Floor that opens on a later zone leaves its tab scrolled out of
  sight.** Seen, 2026-10-24 (A797 slice 4's look, 390 px): a handheld whose "Opens first" is
  Upstairs bar opens there, but the zone tab strip stays at its start, so no highlighted tab shows;
  tapping the tab scrolls it into view. A handheld with no saved choice opened on that zone by its
  address does the same, and `apps/till/src/screens/till-floor-screen.ts` is unchanged by that
  slice, so I believe it predates it; the slice makes it the usual case. Fix: scroll the selected
  tab into view when the Floor opens on it.

- **A1056. A zone with no tables shows the till's Floor as a blank page with no message.** Seen,
  2026-10-24 (A797 slice 4's look): the demo's Upstairs bar, a counter zone with no tables, draws
  nothing on a handheld's Floor whether it is tapped or opened first. Since that slice a handheld
  can open there. Fix: say the zone has no tables.

- **A1082. At 390 px the counter till's top bar is cut off.** Seen, 2026-10-24 (A789 slice 2's
  look, `11-counter-sale-390-light.png` in `~/waitron-campaign-c/a789-2-shots/`): the first tab,
  Counter with its zone, reads "Counter: Do", and the buttons after it (Floor, Parked, Waiting)
  are out of sight; the bar scrolls inside itself, while the page itself does not scroll sideways.
  A handheld's top bar fits at the same width. Slice 2 did not change the top bar,
  so I believe it predates it.

- **A1093. Handheld 1 sometimes shows its zone tabs with no floor map until a zone tab is
  tapped**, after sign-in and after a send. Seen, 2026-10-25 (A789 slice 4's look, `x-hl-after.png`,
  `10`, `11`, `49` and `50` in `~/waitron-campaign-c/a789-4-shots/`), also before any period had
  ended. Origin not checked.

- **A1094. After a dialog is closed with Escape, the next till dialog draws a blue focus ring around
  the whole dialog** in the light theme; a first opening draws none. Seen, 2026-10-25 (A789 slice
  4's look, `06` and `08` against `33` in `~/waitron-campaign-c/a789-4-shots/`). I believe it is
  the shared dialog's keyboard-focus style reacting to the Escape key; not checked.

- **A1057. A handheld whose profile allows no zones shows a blank Floor.** Seen, 2026-10-24 (A797
  slice 4's finish review, a browser probe on the branch): a till in that state shows the
  empty-zones page with Settings and Retry, but a handheld's home is always the Floor
  (`homeScreenFor`, `apps/till/src/till-app.ts`), so it draws an empty Floor with no message. On
  `main` before that slice a handheld's home was the Floor too, so I believe it predates it (read,
  not run). Fix: give a handheld the same explanation and Retry.

- **A934. The till's Spanish for parking an order before hiding a zone says «Retén».**
  `device_zones.order_in_zone` (`apps/till/src/i18n/strings.ts`, English "Park, send or cancel…")
  reads «Retén, envía o cancela este pedido…», while parking is «aparcar» everywhere else
  (`held.title` «Pedidos aparcados»). Proposed: «Aparca, envía o cancela…».

- **A921. On a narrow till, should the person's name give room to the tab strip? (question for the
  owner, left open by A582 slice 4a).** Since 4a the till's bar has the Help switch before the
  person's menu, and nothing else left the bar for it, so at phone width the tab strip, which
  already scrolls sideways, is 52 px narrower: with a long name at 320 px it is 8 px wide, so its
  tabs are reached only by scrolling a sliver. One answer: two tap widths for the name instead of
  three at phone width, which would give back 44 px. That changes A738's look, so it is the owner's
  call. [Detail](backlog/till.md#a921-on-a-narrow-till-should-the-persons-name-give-room-to-the-tab-strip)

- **A922. Discard on a table's bill from Parked orders fails.** The till sends no bill editor's
  expectation, and the server refuses a party bill's discard without one (400
  `management.request_invalid`), leaving the bill open. Found while planning A582 slice 4; not fixed
  there. [Detail](backlog/till.md#a922-discard-on-a-tables-bill-from-parked-orders-fails)

- **A803. Bills and tables: one portion per order line, one bill switcher, one picker (owner,
  2026-10-18).** Owner-approved design; A773-1 has landed. Its portion, bill and picker slices
  remain queued in lane G. Remaining slices: portions and current ticket/receipt grouping; named, stable-numbered bills;
  always-on bill dropdown with + New bill, even for one bill, and one kebab with current-bill
  then Whole table headings; one picker for Move dishes and Split a table, including waiting
  courses; pre-bills after asesor S2 (A446). The main bill and Tab go; the table
  footer has totals and Pay, no Hold. This bill's unsent dishes make Pay quiet but tappable,
  explaining "Send or remove the unsent dishes before paying." Other bills' drafts do not quiet
  it. Full invoice is offered at payment per A739; the plan keeps an unpaid-bill menu shortcut,
  while paid correction waits for A802's known entry or an owner decision, with no A803 fiscal
  implementation. One payment pays one bill. Station modes, pass naming and grouped cross-bill
  firing wait for pending A773-2, independently of S2. Slice 1 requires owner sign-off at land;
  new Spanish wording requires approval during implementation. Each new seating starts at Bill 1
  (owner, 2026-10-19); bills staying at their table retain their numbers.
  [Spec](superpowers/specs/2026-10-18-a803-bills-and-tables-design.md);
  [plan](superpowers/plans/2026-10-19-a803-bills-and-tables.md);
  [mockups](backlog/mockups/a803-bills-and-tables/).

- **A893. Owner review of every table state and its look, after A757 lands (owner, 2026-10-18).**
  Show the owner each state on the map and the card, both themes, with the pulses and zone tabs, and
  settle the two suggestions in the detail. A757 is built (slice 8, 2026-10-22); ready to show the
  owner.
  [Detail](backlog/till.md#a893-owner-review-of-every-table-state-and-its-look-after-a757-lands)

- **A936. Waiting's minutes on the map (left open by A757 slice 5).** The map's cue for a waiting
  table says "Waiting", not the minutes picture 07 draws, because the floor read carries only the
  timing band; showing minutes needs the oldest fired dish's age in the read.
  [Detail](backlog/till.md#a936-waitings-minutes-on-the-map)

- **A1005. A till a few seconds ahead cannot clear an every-N-minutes repeat that follows a Done
  (left open by A757 slice 8).** Its Done answers `{ cleared: [] }` until the server's clock
  reaches that repeat. A Done now carries the `dueAt` the till showed, so the server could accept a
  shown repeat a few seconds ahead (the plan's Decision 5: "A live step not yet due is accepted").

- **A937. Measure the owner's real floor plan once it is drawn (left open by A757 slice 5).** Slice
  5's size check ran on Santet's invented grid, where Terrace's tables show names but no cue; re-run
  it on the owner's floor. [Detail](backlog/till.md#a937-measure-the-owners-real-floor-plan-once-it-is-drawn)

- **A995. The floor's ready and held chips count a gram or millilitre dish by its quantity (left
  open by A757 slice 6).** 150 g of a dish reads 150 on the floor's chips and 1 item on the order
  lists, and the order screen's draft count adds 330 for a 330 ml dish; the fix is to use the
  server's whole-portion rule in all three.
  [Detail](backlog/till.md#a995-the-floors-ready-and-held-chips-count-a-gram-or-millilitre-dish-by-its-quantity)

- **A996. Find a bill still counts lines (left open by A757 slice 6).** Its Items column counts a
  bill's lines (`apps/server/src/find-bill-bills.ts:44`), so for one bill it can disagree with the
  Parked orders row, which counts items.

- **A997. An open order's item counts change when its dish's unit is changed (left open by A757
  slice 6).** A line freezes its unit's decimal places (`unit_precision`) but not whether the unit
  is a measure or a scale's, so `readOrderStateCounts` (`apps/server/src/order-state-counts.ts`)
  reads those from the product's current unit. Measured 2026-10-22 with a case added for the run to
  `apps/server/src/order-state-counts.test.ts` and not kept: a parked 330 ml dish read `ordered: 1`
  before `assignProductUnit` moved its product to a whole-portion unit and `ordered: 330` after. The
  plan's owner point 15 names this default. The fix freezes that choice on the line, which takes a
  migration.

- **A900. A757 slice 7's open questions, built with defaults (left open by slice 7, 2026-10-19).**
  For the owner, a candidate question to batch: the words the pictures do not draw — the fifth
  start's label ("Repeats after the last order" / "Se repite tras el último pedido"), the Spanish
  starter names ("Montar mesa", "Tomar nota", "¿Algo más?"), the Spanish labels, the minutes
  field's screen-reader label ("Minutes" / "Minutos") and the required stars on the "Step" and
  "Starts" column heads. The owner sees at land that deleting a course deletes the steps that start
  from it, and that a step left first that started after the step before then starts When seated. The starter names are English when the venue's first receipt language is English and
  Spanish otherwise (`packages/venue-service/src/service-steps.ts`), which the English-only rule
  (owner, 2026-10-19) does not allow; A918 fixes it. Not put to the owner (plan's question 3): a department created
  later in the dashboard gets the starter steps. Also for the owner, from #1891's look and review: the
  start box cuts labels short — "Repeats after the last order" at every width (Chromium on macOS:
  the text needs 176 px and the box gives 150 on a desktop), and several more at phone width once
  the minutes box grew to 120 px — so either a shorter fifth-start wording or the start on its own
  line on a phone; the minutes field has no visible required mark, since its column heading is
  hidden; and when only the step list is refused, the form's bottom message stays blank, where the
  forms contract expects the refusal's own sentence there.
  [Open questions](superpowers/plans/2026-10-19-a757-7-service-step-settings.md#open-questions-each-with-the-default-this-plan-uses)

- **A923. The voids and comps list is a plain table (left open by A758-2).** It has no column
  chooser, Filters or remembered view, and its own CSS keeps the row menu on a phone's screen,
  because the shared reorder helper (`ReorderController`) cannot reach `wt-data-table`'s rows. The other way is to teach
  `wt-data-table` to reorder rows (a `packages/ui` change), giving every reorderable list one
  table. Owner to choose.

- **A1007. The till's adjustment window keeps a give-away and a line discount nothing opens (left
  open by A758-5).** Retire the two modes, make `kind: "comp"` mean the Comp window, and move the
  table's comp tests in `till-app-adjustments.test.ts` onto it.
  [Detail](backlog/till.md#a1007-the-tills-adjustment-window-keeps-a-give-away-and-a-line-discount-nothing-opens)

- **A1011. The owner looks at the till's Comp words as built (left open by A758-5).** Each works as
  built; the owner may want it different. The list, with the built pictures, is under "For the owner
  to look at" in [PR #1976](https://github.com/clintongormley/waitron/pull/1976): one Comp… per
  dish and per extra at the counter; Free on the bill only under a reason allowing Free and a
  percentage; the bill's window opening on %; the words no picture drew; the "Comp…" heading where
  picture 04 draws "Comp"; the confirm steps never saying "Free"; the two windows asking in opposite
  orders; Comp… still offered on a line already at €0.00 (the server refuses it, 409
  `adjustment.no_reduction`); and two English refusals the Comp windows can show still saying
  "discount" (`adjustment.exceeds_amount`, `adjustment.no_reduction`).
  [Pictures as built](backlog/mockups/a758-adjustment-reasons/built/)

- **A1020. The owner looks at A758-6's words and choices (left open by A758-6).** Each works as
  built; the owner may want it different: among them no Table finished on the pass, Not served
  found by its English name, the PIN carried from the cancel to its refund, and a finished table
  checked against all its bills' zones.
  [Detail](backlog/till.md#a1020-the-owner-looks-at-a758-6s-words-and-choices),
  [pictures as built](backlog/mockups/a758-adjustment-reasons/built/)

- **A1021. Cap Void and Comp reason names at the reasons route (left open by A758-6).** The reasons
  page and its route (`packages/adjustments/src/routes.ts`) take a name of any length, while a
  receipt's refund refuses a reason over 500 characters (`tender-refund-reservation.ts`), which the
  till marks `bill_refund.reason_long`.

- **A1031. The owner looks at A758-7's choices (left open by A758-7).** Each works as built; the
  owner may want it different: held dishes fired on the way to the counter; each bill with food
  still to come moved as its own counter order; the order keeping its table's zone, so a till or
  pass limited to the counter's zone does not show it; a bill whose food to come has no kitchen
  ticket staying with the table; the toast reusing "Moved to the counter"; and the settled-order
  freeze now letting any paid table bill not yet handed over leave its party — only the server
  limits that to Finish table — an exception `scripts/behavioural-triggers.test.ts` does not yet
  hold. [Plan](superpowers/plans/2026-10-22-a758-7-collect-at-counter.md#owner-points-each-with-the-default-this-pr-builds)

- **A1032. Nothing on the pass says an order waits at the counter (left open by A758-7).** A paid
  order a finished table sent to the counter is named on the pass and in Waiting orders by its
  number and the table it was paid at ("#12 Mesa 4"), as Move this bill → The counter names one
  today; only the MOVED slip and the station notice say "counter".

- **A1033. A full invoice's later copies change their guests line when a bill moves to the
  counter (left open by A758-7).** A full invoice reads its guests from the bill's party each time
  it prints, and only while the party's family holds exactly one bill (`readReceiptGuests`,
  `apps/server/src/receipt-guests.ts`): the moved bill's copies lose the line, and when one of two
  paid bills moves, the copies of the bill left behind gain one. A simplified receipt keeps the
  count stored at payment.

- **A1030. Firing one held dish is refused on a merged-in party's paid bill (found by A758-7).**
  `fireHeldLine` (`apps/server/src/order-groups.ts`) looks for the dish only among bills whose
  `party_id` is the table's own party. A paid bill keeps the party it was paid under, so after
  Combine tables a held dish on the absorbed party's paid bill answers `group.not_found`. Firing the
  whole group, or collecting at the counter, fires it. It predates A758-7 (`c9ad7a634`).

- **A1029. The till has no words of its own for `station.no_default` (found by A758-7).** No key
  for it in `CODE_MESSAGES` (`apps/till/src/i18n/codes.ts`), so `codeMessage` falls back to the
  generic "Something went wrong, try again", and a waiter whose station has no default printer is
  told to retry a request that cannot succeed. It predates A758-7
  (`git log -S'"station.no_default"' -- apps/till`).

- **A924. Void and Comp lozenges are neutral, not red and green as picture 01 draws (left open by
  A758-2).** `wt-lozenge` takes only a hex colour and a screen may not write one, so the word
  carries the meaning. Owner to confirm, or `wt-lozenge` gains token colours.

- **A925. Words on the voids and comps page that no picture drew (left open by A758-2).** The
  Delete question's sentences, the hint shown while searching («Borra la búsqueda para cambiar el
  orden.»), the Spanish intro and the limits («{percent}% por artículo», «{amount} por cuenta»), in
  `packages/adjustments/src/dashboard/strings.ts`. Owner to read them.

- **A926. A deleted reason re-added under the same name starts its limits' count again (left open
  by A758-2).** The item and bill limits count earlier comps by the reason's id
  (`packages/adjustments/src/record.ts`), and a re-added reason has a new one, so on an open bill
  its limits start from nothing. Accepted for now (plan Decision 2); revisit if a venue meets it.

- **A952. The report's totals are headed "By action", not "By kind" (left open by A758-3).** Its
  rows are Voids and Comps («Por acción»), D10's names for both kinds and actions; design §3.6
  says "By kind" («Por tipo»). Owner to choose; the other way changes eight heading checks.

- **A953. By reason's column says "Requested by", not "Asked by" (left open by A758-3).** The
  entries list beside it already says "Requested by" («Solicitado por») for the same person; design
  §3.7 writes "Asked by". Owner to choose one word for both places.

- **A954. How the report's Reason filter behaves (left open by A758-3).** It keeps its choice when
  another person's list opens or the days change, and goes back to All reasons when the list
  closes. A deleted reason re-added under the same name shows twice in the field, because the
  report groups by the reason's id. Owner to confirm.

- **A956. The report's new words, for the owner to read (left open by A758-3).** Voids / Comps («Cancelaciones» /
  «Descuentos»), Void («Cancelado»), "Comp {amount}" («Descuento {amount}»), All reasons («Todos
  los motivos») and the reworded intro, in `packages/adjustments/src/dashboard/strings.ts`. The
  PR's pictures show them; owner to read them.

- **A957. The Spanish report still says «anulado» beside «Cancelaciones» (left open by A758-3).**
  The column «Valor de carta anulado» and the summary figure «Valor de carta de lo
  anulado» (`packages/adjustments/src/dashboard/strings.ts`). D10 makes Void «Cancelar» and D22
  asks for one word per meaning, but nothing gives these two phrases. The other way: «Valor de
  carta cancelado» / «Valor de carta de lo cancelado». Owner to choose.

- **A958. Choosing a reason narrows the list, not the totals below it (left open by A758-3).** With
  Staff meal chosen, By action, By stage and By reason still count every reason for the person (or
  everyone) shown. Owner to confirm, or the breakdowns follow the chosen reason too.

- **A959. By reason's layout (left open by A758-3).** It now takes the whole row, so on a wide
  window its numbers stand far apart and the last figure ("List value cancelled") sits right
  against the Requested by names; on a phone the table scrolls sideways inside its box, with only
  the cut-off last column to say so. Owner to look at the pictures and say whether either wants
  changing.

- **A909. A recalled draft's Discard asks for a refund PIN for a dish that may not have been
  started (left open by A758-1).** Cancel item… asks "Has preparation started?" and removes a dish
  not started with no PIN (`apps/server/src/line-cancel.ts`). A recalled draft's Discard previews
  each sent dish as a cancel through the adjustment path (`apps/till/src/till-app.ts`
  `#onAdjustPreview`), which cannot ask, so a fired dish counts as possibly started and needs
  someone who can give refunds (`evaluateCancel`, `packages/adjustments/src/policy.ts`). Stricter
  than design D12. Decide whether Discard should ask the question too.

- **A910. A reason's item limit errs toward asking (left open by A758-1).**
  Revisit if a venue meets an approval it did not expect. Decide whether an item's count should
  follow it to another bill. [Detail](backlog/till.md#a910-a-reasons-item-limit-errs-toward-asking-left-open-by-a758-1)

- **A911. What counts as a full comp (left open by A758-1, A758-3 and A758-4).**
  Free always counts, even after an earlier comp took part of the price, so it prints «Descuento 100%»
  beside what was left, as a 100% percentage already does. Owner to confirm both halves.
  [Detail](backlog/till.md#a911-what-counts-as-a-full-comp-left-open-by-a758-1-a758-3-and-a758-4)

- **A919. Three reason-form limits show "No limit" as a placeholder and also carry a hint (left
  open by A758-1).** The voids-and-comps form's limit fields use `adjustments.no_limit` as the
  placeholder beside a hint (`packages/adjustments/src/dashboard/reasons-screen.ts`). By
  [design-system.md](developers/design-system.md) → Forms a field's hint is its placeholder, so the
  hint may only reach screen readers. Nobody has looked at the screen to confirm; look, then pick one.

- **A920. The till's approval prompt: the Spanish no longer matches the English (left open by
  A758-1).** `override.pick_supervisor` became "Choose who approves" but stays «Elige a un
  responsable» (`apps/till/src/i18n/strings.ts`). Not wrong; reword the Spanish to match.

- **A918. Starter content in the venue's languages at setup (left open by A758-1).**
  Starter content a module writes into a new venue is English, translated when the box is set up
  (owner, 2026-10-19), but nothing translates it yet: A758-1's nine void and comp reasons are English
  on every venue. The owner chose (2026-10-20): each module ships a translation file of its starter
  names, setup writes every language the venue uses from it, and the English-only check is to allow
  those files. It
  covers reasons, the kitchen station «Cocina», device profiles, service steps, seasons and units, and
  is A913's point 1 ([audit](backlog/english-only-audit.md), Bucket D; [A913's
  items](backlog/architecture.md#a913s-fix-items-general-code-english-only)).

- **A912. A new venue's set-up report still says "default cancel reason ready" (left open by
  A758-1).** It now seeds nine starter reasons (`packages/adjustments/src/provisioning.ts`; pinned
  in `provisioning.test.ts` and `packages/provisioning/src/venue-apply.test.ts`). Reword it.

- **Review follow-up: nutrition for extras in Sent.** The Current orders wire's extra summaries
  carry no nutrition. The Sent dish window can recover an extra's nutrition from matching bill
  lines; `till-table-order-screen.served-details.test.ts` checks that fallback and its removal when
  the line identities no longer match. Reproduce a dish and a differently declared extra with and
  without those bill-line details, then decide whether the service read and Sent rows should carry
  the extra's nutrition too. The visual comparison remains unverified; A668-5's dish-name scope
  does not decide it. See `apps/till/src/api/client.ts` (`CurrentOrderRow.extras`) and
  `apps/till/src/screens/till-table-order-screen.ts` (`#sentDetails` and `#sentLineDialog`).

- **A785. A kitchen screen in device mode keeps the theme it started with until reload (left open
  by A768, 2026-10-17).** Nobody signs in on it, so it runs no menu-state poll and never sees the
  setup revision move when the theme in use changes. Its station queue read could name the
  revision, as `/api/menu-state` does. (A756 PR 7, 2026-10-24, moved the bump mode onto each queue
  order, so that refreshes.)

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

- **A take-over or a recall into the order acts as whoever the session is (left open by A791 #1943,
  2026-10-21).** Both are started by a tap and sent after the order's save queue
  (`apps/till/src/state/draft-sync.ts` `#takeOver` and `runCommand`); one started by one person and
  sent after the next person's sign-in answer would act as the next person (read, not run). Whether
  the lock screen always stops such a command first is not traced. If it does not, name the person
  in those requests as A791 did for the save.

- **A sign-out while an order save is waiting may keep the wrong lines (left open by A791 #1943,
  2026-10-21).** If someone signs out while a save of their order is still out and a newer version
  of the bill has already reached the till, their kept unsaved lines could be replaced by the ones
  on screen (suspected by reading `DraftSync.#saveNow`'s error handling in
  `apps/till/src/state/draft-sync.ts`, not reproduced). Reproduce it with a test before changing
  anything; #1943 fixed the same mix-up for its own refusal only.

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

- **A773-2. Firing and the pass.** The [reviewed implementation plan](superpowers/plans/2026-10-19-a773-2-firing-and-pass.md)
  leaves PRs B–D: Requested, scoped pass release, station
  settings and coverage warnings, ticket presentation and physical schema/configuration retirement.
  Recheck other lanes' reservations before each slice. A797's revised design, pictures
  and FYI landed on 2026-10-21; A803's pass/station tail follows this build.
  [Detail](backlog/till.md#a773-courses-groups-and-the-pass)

- **A773 physical-till trial: dragging.** Try long-press movement of New order lines and held
  headings on a physical till. Keep drag only if it works reliably; Move to… and the held heading's
  Move earlier/later actions remain available. Browser gesture checks do not settle this choice.
  [Spec §11](superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#11-left-for-later-backlog)

- **A773 physical-till trial: serving part of a line.** Try marking part of a line served through
  the dish window during service. Decide whether it is practical before changing that workflow.
  [Spec §11](superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#11-left-for-later-backlog)

- **Later, after A773: a station waits for another station's part of a group (owner,
  2026-10-16).** For example, the bar pours the dessert wine when the kitchen marks the tarta ready,
  rather than when the waiter fires the group. A773 starts both parts together and marks the bar's
  part "Goes with kitchen food". Try it once a venue has run with that.
  [Spec §5](superpowers/specs/2026-10-16-a773-courses-and-groups-design.md#5-firing-and-the-pass)

- **Custom item on the Counter (A738 residual; undecided).** The dashed + Custom item tile and its
  window remain unbuilt. The window needs a name, price, required VAT rate and destination
  (nowhere or a station). Decide the permission and whether an underlying product supplies the
  catalogue, reports and invoice-line identity before building an arbitrary-price path.
  [Detail](backlog/till.md#custom-item-on-the-counter-a738-residual)

- **A739 — Park · Pay and one payment window; owner-flow revision, 2026-10-22 ~11:55.** No
  cash slips: EUR10 cash on EUR30 leaves EUR20, no slip. Only card has Print card slip. Before card,
  optionally request its slip; after a part, show what remains and ask the next tender; after
  final payment or a settling edit, offer Receipt / Full invoice / None with separate Print/Email.
  Reader-paper checkbox display is next, preserving the answered no-duplicate policy and native
  paper independence. No-answer/no-timer/no-zone-fallback policy and full revision agreement
  remain separately open. Full invoice after an F2 needs A556's separate fiscal integration;
  public F1 stays gated. Preserve A790/A796 settings and A582's help-mode badges in the build.
  No rebuild before agreement; product integration and acceptance remain open.
  [Current revision](superpowers/specs/2026-10-22-a739-owner-payment-and-receipt-flow.md),
  [four-case boards](backlog/mockups/a739-owner-receipt-flow/README.md),
  [historical detail](backlog/till.md#a739-paying-hold--pay-and-one-payment-window).

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

- Recorded, not blocking: a handheld's Order tab is tappable with no active table; Counter has no
  prep-queue rail.

- **A lost counter Send reply still tells you to check whether a sale went through.**
  `#onPlaceOrder` uses `sale.unconfirmed`; its English and Spanish strings refer to a sale.
  The HTTP retry case in `apps/server/src/place-replay.test.ts` checks that placement leaves
  `sales` empty. **Next action:** give a counter send its own
  uncertainty message, telling you how to retry without implying a payment was taken.

- **`apps/till/src/till-app.ts` decides permanent-refusal / known-code / unknown at six call sites;
  a helper would collapse it.** Cosmetic, and cheapest alongside A848 (the empty-order message) that
  touches `#onPayTab` (under _Payments and card readers_). Raised by the A1 review wave (A1d).

- **Loose ends left by A395 (#1435) and A425, the till's one-row top bar.**
  Open, decided as built: a change in the pending-transfer count alone never brings items back
  onto the bar, so when the count shrinks or goes away, items can stay in More although they
  would now fit, until the next resize or other change refits the bar.
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
  `wt-input` has no visible description: the Add tables names preview is a polite live region
  after Prefix, so it is not heard when the field takes focus.
  [Detail](backlog/till.md#loose-ends-left-by-a466-a429-slice-2--a502-part-3)

- **Loose ends left by A672.**
  No key moves a floor plan table's top or left side or a corner. Shift with the arrow keys
  moves only its right and bottom sides.
  [Detail](backlog/till.md#loose-ends-left-by-a672)

- **Loose ends left by A718.**
  `wt-floor-plan-preview` has no product user. Retire it, or record why it is kept.
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

- **A1012. Delivery for online orders (owner, 2026-10-22).** An A509 online order taken to the
  customer's address instead of collected. Needs the internet, as A509 does, and comes after it.
  Backlog only, not queued to a lane.
  [Detail](backlog/till.md#a1012-delivery-for-online-orders)

- **Loose ends left by A429 slice 1 (#1493).**
  The bookings list shows no table for any booking, and a past booking's kept table name
  (`bookings.table_label`) is stored but shown nowhere.
  [Detail](backlog/till.md#loose-ends-left-by-a429-slice-1-1493)

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
  Two device choices can lose a switched-off entry.
  [Detail](backlog/till.md#loose-ends-left-by-a366-slice-5-part-a-1479)

- `service_commands` rows are never pruned. Left open by service Task 2 (#715, a record per seated
  party).

- **Loose ends left by service Task 3 (#733, order groups).** A cross-party merge can leave a
  settled check's lines naming a group now on the target party; three more points are in the
  detail. [Detail](backlog/till.md#task-3-733-order-groups)

- **Loose ends left by service Task 5 (#750, kitchen, pass and table screen by group).**
  - A fired group with nothing for the kitchen (bottled water, say) never reads Ready.
  - Every pass press moves the party's revision, so a waiter's open Tab drawer meets
    `party.out_of_date` after it and reads again.

- **Loose ends left by service Task 7 (#789, each person's draft kept on the server).** A draft
  that moves to the other party in a merge records no history event; the server's own
  `unavailable` flag misses some lines that are refused at submission; and remaining rulings made on
  the branch are for the owner to confirm.
  [Detail](backlog/till.md#task-7-789-each-persons-draft-kept-on-the-server)

- **Loose ends left by service Task 8 (#806, the till works from the server's drafts).** The old
  send-timeout, server logout and remaining screen observations are in the detail. Local draft
  recovery on sign-out, failed-read editing protection, pending-takeover helper checks and
  visible-table refresh follow the
  [per-bill ownership decision](backlog/till.md#one-editor-per-bill-owner-2026-10-17-a773).
  [Detail](backlog/till.md#task-8-806-the-till-works-from-the-servers-drafts)

- A line outside any group that needs no kitchen, held, and first released after its bill was paid
  could not be marked served (`group.line_held`), because `stampSent` wrote `sent_at` only on an
  open bill. Since B21 (#969, core `0053`) `stampSent` writes on any bill but an abandoned one;
  whether this case is now served was not measured. Left open by service Task 9 (#814, served by
  quantity, release reminders, Current orders).

- **Loose ends left by service Task 10 (#908, the service dashboard's attention signals).** For the
  owner. [Detail](backlog/till.md#task-10-908-the-service-dashboards-attention-signals)
  - The till drops the bill request's late answer, a refusal included, once the waiter has signed
    out or left the party (`#onRequestBill`, `apps/till/src/till-app.ts`). **Next action:** decide
    whether a late refusal should be said.

- **Loose ends left by service Task 11 (#916, cancellations, comps and discounts; B11a–B11g).**
  The adjustment history records who approved, but not whether the bill's comp limit or the refund rule,
  rather than the reason, is why.
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- The till's "Amount off (€)" writes the euro sign into the label rather than taking the venue's
  currency. How a comp or discount appears on the invoice is still asesor Q29. Left open by service
  Task 11 (#916).

- `PUT /api/working-orders/:id/lines/:lineNo` reads only the fields it names, so a `frozenExtras`,
  `frozenOptions` or `productId` sent there is ignored rather than refused as the other till routes
  now do (#1531); nothing is priced from them. **Next action:** decide whether it should refuse them
  too.

- **Loose ends left by service Task 16 (#981, counter handover).**
  A collect straight after Place order does not re-read the kitchen queue.
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **Loose ends left by service Task 17 (#991, a table that leaves without paying).**
  Collecting PART of the debt later is not built. Collecting it in full uses
  `POST /api/working-orders/:id/collect`.
  [Detail](backlog/till.md#task-17-991-a-table-that-leaves-without-paying)

- **Gaps against the service plan's acceptance checks (spec §12)**, from a sweep on 2026-10-01: **No
  permanent test lays the service screens out at phone and till widths in both themes (§12 item
  14).** The axe scans run in both themes, mostly at the browser's default size with one block at
  390 px (`apps/till/src/screens/till-table-order-screen.a11y.test.ts`).

- **Loose ends left by C126 (cancelling an order whose invoice was issued credits it, #1030), B32
  (#1055) and B34 (#1077).**
  [Detail](backlog/fiscal.md#c126-cancelling-an-order-whose-invoice-was-issued-credits-it-owner-2026-10-02-option-b-decided-without-the-asesor--landed-as-1030)
  - **The approver list is fetched with no time limit.** The unpaid-departure and refund dialogs
    fetch theirs the same way and predate B32; a time limit belongs on all three together.
  - **No till test covers a payment refusal that arrives after the approver's PIN** (since A845,
    #1895, the PIN prompt comes first).

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
  Counter custom items (A738 residual) and the payment window (A739) remain. The handheld,
  kitchen screen and pass are **A797**, designed 2026-10-18 and revised 2026-10-21 for the owner's
  Q42 answer; Q51 was answered 2026-10-24 (all recommended; the Ready warning time in each prep
  station's editor), so nothing waits for it. 10–11 wait for A803's slice 3 and 12–12b follow
  A773-2. Slice 4 (zones on a handheld) landed in #2041 and slice 5 (the Ready bar and
  List/Map kept per zone on the device) in #2063, and slice 1 (table short names, data) in
  #2076, and slice 2 (the dashboard's short-name field, which refuses a "+") in #2083, built from
  the build plan; slice 3 is next:
  [build plan](superpowers/plans/2026-10-24-a797-device-screens-build.md),
  [design](superpowers/specs/2026-10-18-a797-device-screens-design.md),
  [mockups](backlog/mockups/a797-device-screens/). A737 Part 2 adds the separate
  durable post-invoice payment-refund path. The screen designer was
  retired in [#1800](https://github.com/clintongormley/waitron/pull/1800) without redesigning those workflows.
  [Detail](backlog/till.md#build-good-screens-for-each-kind-of-device-and-retire-canvases-a182-owner-2026-10-01)

- **A1101. Short names on the floor map where a full name does not fit, and on printed kitchen
  tickets.** A797's design proposes both (§3.7, §9) as later choices for the owner; A797 builds
  neither. Today the map hides a table's name when the table's shorter side is drawn under 28 px
  (`NAME_MIN_PX` and `showsName`, `packages/ui/src/floor-plan-geometry.ts`), and the kitchen ticket
  prints the table's name as the floor shows it — its group's or its own name for today, else its
  full name — and never its short name (`tableLabel`, from `orderTableLabels` in
  `packages/db/src/party-table-labels.ts`). Ask the owner first.

- **A1102. The till's tests name tables in Spanish.** `apps/till/src/till-app.test.ts`'s counter
  move cases use "Mesa 9" and "Mesa 7", and many other till test files use "Mesa …" labels
  (`git grep -l '"Mesa ' -- 'apps/till/src/*.test.ts'`), against the English-only rule (CLAUDE.md
  §3). This is the till's share of the Spanish test data the
  [English-only audit](backlog/english-only-audit.md) counts in its `apps/till` row; A976 covers
  the server's test venues, and A977's list of test folders still to clean is where this joins. A797
  slice 1's till test fixtures copy labels into `shortName` (`apps/till/src/api/client.test.ts`'s
  "Mesa 1" and "Mesa 2" among them), so renaming a label means renaming its short name too. Low
  priority.

- **A1103. At 390 px the floor plan editor leaves a refused Name field half under the panel's
  heading.** Seen, 2026-10-25 (the A797 slice 1 look, `r-refusal-390-light-en.png` in
  `~/waitron-campaign-c/a797-1-shots/`): after a refused save the Name field is scrolled only partly
  into view, and its "Name *" label sits under the panel's sticky heading ("W1 ⌄"), so only the
  value and the refusal under it show; scrolled by hand, the label shows
  (`r-refusal-field-390-light-en.png`). Slice 1 changed which sentence the editor shows, not where
  it scrolls. Slice 2's look (2026-10-26, `~/waitron-campaign-c/a797-2-shots/`) found the cause:
  the phone sheet keeps its scroll when the refusal selects a table, and nothing brings the field
  into view. With the sheet at its top the refused Short name shows whole under the heading;
  scrolled down to the list before Save, the whole field, label, value and refusal, is above the
  visible part of the sheet and only the list shows (`c2-refused-390-light-en.png`). Tapping a row
  in the list leaves the form scrolled the same way (`a0-select-as-lands-390-light-en.png`).

- **A1104. Should the till's Ready bar sort by the short name it shows?** Seen, 2026-10-25 (the
  A797 slice 1 look, `e-bar-dining-390-light-en.png` in `~/waitron-campaign-c/a797-1-shots/`): the
  bar lists parties in the order their first table appears in the floor's tables (slice 5 of the
  [build plan](superpowers/plans/2026-10-24-a797-device-screens-build.md)), which in the look ran
  by full name, so "Window 1", shown as W1, came last: "2 · 1", "T1+T2 · 1", "W1 · 1". Ask the
  owner.

- **A1105. At 390 px in English the till's Ready bar hides its last entry under "Open ›".** Seen,
  2026-10-25 (the A797 slice 1 look, `e-bar-dining-390-light-en.png` in
  `~/waitron-campaign-c/a797-1-shots/`): with three entries the last, "W1 · 1", is cut off by the
  "Open ›" button and the bar scrolls sideways to reach it; in Spanish all three fit
  (`e-bar-dining-390-light-es.png`).

- **A1106. The till's List cards say "1 items".** Seen, 2026-10-25 (the A797 slice 1 look,
  `h-list-dining-390-light-en.png` in `~/waitron-campaign-c/a797-1-shots/`): Window 1's card reads
  "€6.50, 1 items". Fix: a singular wording for a count of 1.

- **A1107. Spanish calls a forgotten table «Olvidado» on its details sheet and «Olvidada» on its
  List card.** Seen, 2026-10-25 (the A797 slice 1 look, `g-details-window1-390-light-es.png` and
  `h-list-dining-390-light-es.png` in `~/waitron-campaign-c/a797-1-shots/`), for the same table.
  A1076 is a different Spanish wording of the same flag, in the station editor.

- **A1108. The till order screen's Sent panel reads "Sent !" and "Held ·".** Seen, 2026-10-25 (the
  A797 slice 1 look, `f-header-window1-1024-light-en.png` and `f-header-window1-1024-dark-es.png` in
  `~/waitron-campaign-c/a797-1-shots/`): a space before the "!" ("Sent !", «Enviado !»), and the
  Held line ends in a separator with nothing after it, where the Served line above reads
  "Served · 0 · €0.00".

- **A1109. The floor plan editor opens Terrace as an empty grid, and its phone Tables panel has a
  large blank gap.** Seen, 2026-10-25 (the A797 slice 1 look, `r-refusal-1280-light-en.png` and
  `r-tables-panel-390-light-en.png` in `~/waitron-campaign-c/a797-1-shots/`): at 1280 the demo's
  Terrace tables lie beyond the visible canvas, so none shows without scrolling; at 390 the Tables
  panel leaves a large blank space between Add tables / Add joined table and the list.

- **A1112. The server, the API and a configuration file still accept a "+" in a short name.**
  The dashboard's floor plan editor refuses a "+" in a short name it would save, unless the table
  already had it stored (`refusesPlus`, `apps/dashboard/src/screens/floor-plan-draft.ts`; A797
  slice 2), because the till writes tables joined for today as "T1+T2". The server's save
  (`resolveShortNames`, `apps/server/src/table-short-names.ts`) and the configuration import do
  not, and the proposal keeps a name of four characters or fewer whole, so a seed, an API call or
  an imported file can still give a table "1+2" or "T1+T2", which reads on the Ready bar like one
  of today's joins.

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
  `#switchProfile` was reading identity. A682 isolated one test that deliberately returns null and
  emits the same rejection; the real-response investigation remains open. The detail retains the
  command and the limits of that probe.
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
  the `--wt-*` CSS variables it already reads, and upload the venue's own logo (owner, 2026-10-20),
  which takes Waitron's place in the dashboard banner and the till's top bar, with "Powered by
  Waitron" under both sign-in forms, and prints on receipts and A4 invoices where no department
  receipt logo applies; a text-size slider and text set by hand under Advanced, which is folded into
  sections (owner, Q4, 2026-10-20); and saved custom themes, one in use everywhere at a time, each
  with a light and a dark version that the Theme setting (Light / Dark / Follow device, keeping its
  name) switches between (owner, 2026-10-20). Design, **final**:
  [2026-10-19-a841-theme-editor-design.md](superpowers/specs/2026-10-19-a841-theme-editor-design.md).
  All eight questions and the extra one are answered (Q8 revised the same morning; section 19). The
  build is 14 slices, only slice 2 adding a migration (design section 16). Slice 1 landed
  2026-10-21 (#1927): the theme derivation, the contrast rules shared with `colors.test.ts`, the
  sweeps and the token-list guard, in `@waitron/ui-core/theme`. Slice 2 landed
  2026-10-21 (#1932): custom themes stored in `custom_themes` (`tenant_themes` retired), their
  routes, the theme in use served at `/api/theme`, the till's `themeHash`, and configuration copies
  at format 6. Slice 3 landed 2026-10-21 (#1940): the theme in use reaches the screens — the dashboard and
  the till apply the browser's stored copy at start and fetch `/api/theme` without waiting on it;
  an open dashboard follows through a passive live read of `custom_themes`, and a signed-in till
  through its `themeHash` once per poll. Slice 4 landed 2026-10-21 (#1945): text painted in the brand colour
  reads `--wt-color-primary-text`, and a root guard (`scripts/primary-coloured-text.test.ts`) refuses
  `color: var(--wt-color-primary)` outside a list of icons and spinners. Slice 5 landed 2026-10-21 (#1947): Settings →
  Appearance shows the theme in use, and a manager edits the brand colour, background and corners in
  place with a Light and Dark preview, warnings with one-press fixes, Fix all and a Hard to read
  dialog before saving anyway. Slice 13 landed 2026-10-22 (#1959): the Themes card lists Waitron's theme and the venue's own; a
  manager adds, copies, renames, deletes and switches themes, edits any of them, and names a draft
  with Save as new theme…; Edit works while Waitron's theme is in use, so a new venue makes its first
  theme from the screen. The create button reads "Add theme", not the design's "New theme", by the
  house Wording rule (`design-system.md`). Slice
  6 landed 2026-10-23 (#2021): Advanced, in the Look card's editor, lists the 22 colours with a Light and a Dark
  value each, set by hand with a picker or a code, put back one at a time or all at once, with
  warnings and fixes under the rows; Pick a different colour for dark screens gives the dark version
  its own button colour. Until slice 11 its heading and opening line leave out text, and until slice
  12 it is one flat list. Slice 7 landed 2026-10-24 (#2029): a theme's document names a venue logo — a
  library image and an optional one for dark screens — checked on save and on import; the image
  library counts it as a use and refuses to delete it; `/api/theme` serves the images' addresses,
  and its hash, the till's `themeHash` and the dashboard's live read follow a reframed or replaced
  image; every save that sets or changes its light image, and every library reframe or source
  replacement of that image, draws its printed dots (`printedLogo`), which slice 9 prints. A cash register's bar shows no logo until slice 14. Slice 8a
  landed 2026-10-24 (#2035): the Look card's Logo field (a main image and an optional
  one for dark screens, picked from the image library), the preview's banner strip, the saved card's
  Logo row, Use Waitron's look removing the logo, and the image library naming the use "Logo of
  theme {name}" with a link to the Appearance page. Slice 8b landed 2026-10-24 (#2042): the venue's
  logo replaces Waitron's in the dashboard banner, a handheld's bar and the till and handheld
  sign-in, each image following the screen's Theme setting and dark screens with one image drawing
  it on a white plate (`--wt-color-logo-plate`); "Powered by Waitron" under both sign-in forms while
  a logo is set; with no stored copy, the logo's place stays empty until the first answer or its 5-second limit, and a picture that cannot be
  loaded falls back to Waitron's mark (the banner's lockup, the bar's word, nothing on the till
  sign-in) and is tried again every minute. An optional
  key missing from a stored or copied theme document reads as its empty value (`logo` `null`, and
  for slices 10 and 11 `textScale` 100 and `text` `{}`), with no configuration format change.
  Slice 10a landed 2026-10-24 (#2045): a theme has a text size, 100% to 130% in 5% steps, set with a
  slider on the Look card that shows the four sizes it gives and a till button and bill line in the
  preview; every screen draws it, while the equipment label, the recovery sheet and Google's sign-in
  button keep Waitron's sizes. Slice 10b landed 2026-10-25 (#2048): on the tills, product button and
  bill line names break words of eight letters or more with a hyphen in the venue's default content
  language (shorter words stay whole, so a short word that fits a line is never split), and layout
  cases at 130% hold the counter, the floor, a kitchen queue, the dashboard's shell and the Look
  card. The Look card's preview hyphenates its sample name the same way. Names in a language
  Chromium does not hyphenate, English among them, still break inside a long word with no hyphen.
  Slice 9a landed 2026-10-25 (#2050): the logo of the theme in use prints on receipts and A4
  invoices of every department with no receipt logo of its own and of a sale with no department, a
  department's own logo still first; a department whose receipt settings cannot be trusted prints
  no logo; the till's ticket view and a department's Receipts preview follow the same rule.
  Next: 9b, 11, 12 and 14.

- **The theme delete dialog does not say the tills' text changes size (A841 slice 10a's review,
  #2045).** Deleting the theme in use puts Waitron's theme, at 100%, on every screen; the switch
  dialog says "Text on the tills changes size too." when the size changes, the delete dialog says
  nothing. Owner to decide: give the delete dialog the same line when the deleted theme is not at
  100%, or record the difference as a decision.

- **A cash register on the floor plan with no counter zone misses a theme change (A841 slice 5's review,
  2026-10-21).** A till learns of a new theme only through the setup revision its 15-second menu
  check returns, and that check asks about the counter zone plus the zone of a table whose order is
  on screen (`apps/till/src/till-app.ts:2585-2591`); a cash register whose profile has no counter
  zone gets an empty one at sign-in (`:4884-4901`; a handheld always gets one), so on the floor plan it asks about no zone and keeps the old
  theme until it opens a table, its zones or profile change, or it reloads. Run 2026-10-22 by
  slice 13's review: with the till fixture in `apps/till/src/till-app-setup-refresh.test.ts` changed
  to a signed-in floor view with no counter zone, "a moved theme hash repaints an open till without
  a reload" failed, the background staying on the old colour. The design says every signed-in till follows within one poll (design section 12). Decide:
  have the poll return the setup revision without asking about a zone, or accept it and correct the
  design. The user guide's Appearance page already says what is true. The switch dialog's sentence "every signed-in
  till within 15 seconds" (A841 slice 13, the design's approved words) is untrue for this till too
  until this is decided. The venue logo follows the same path, so such a till keeps an old logo too
  (A841 slice 8b).

- **The colour field's custom colour box shows no focus ring while a custom colour is chosen.** The
  rule `.custom input[type="color"].on { outline: var(--wt-selected-ring) }`
  (`apps/dashboard/src/widgets/color-field.ts`, from #783) replaces the focus outline, so a keyboard
  user cannot see focus on that box; A841 slice 5's visual check found focused and unfocused crops
  identical. Every screen using `colorField` is affected.

- **`wt-slider`'s unfilled track is drawn nearly white on a dark screen.** The range is styled with
  `accent-color` alone (`packages/ui/src/components/wt-slider.ts`, since #1287). A841 slice 10's
  visual check saw Chromium draw its unfilled track nearly white on the Look card's Text size slider
  in dark, where the design's picture draws a dark grey track
  ([screenshot](backlog/mockups/a841-10-text-size/dark-slider-track.png)). Why is not yet
  measured; it is not a missing `color-scheme`, since the dark theme root sets `color-scheme: dark` (`packages/ui-core/src/tokens/colors.css`).
  Every screen using `wt-slider` is affected: the Look card, Menus and photo framing.

- **A841 slice 5 differences from the pictures and tidy-ups (2026-10-21).** Optional, for the owner
  to judge from its [screenshots](backlog/mockups/a841-5-theme-editor/): at a 1280 px window with
  the side menu open the form is about 825 px wide, under the 900 px at which the preview sits beside the choices, so it sits
  below them (pictures 02, 04, 05 show it beside); the warning and fix lines are plain text and a
  plain button, without the pictures' boxes and colour chips; Waitron's choice sits above the swatches
  rather than beside Custom; the theme's name in the editing line is not bold; on a phone the
  preview's sample keeps its side menu beside it while it fits (picture 03 draws it above); and the
  pictures still show Café Limón's light fix as `#9f8b18` and Bar Lucía's dark fix as `#417c59`,
  where the code gives `#9d8a15` and `#437e5b` (a dated note in the design says so). Test
  gaps its reviews left: an unchanged draft off the page following a newer read on re-attach;
  the colour field's refused chip value, disabled code box while saving and same-row placement; the
  warning text's colour; the preview's colour-rebuild check (`theme-preview.test.ts`); Bar Lucía and
  lemon fixtures repeated across test files.

- **A841 slice 6 wording to confirm (2026-10-23).** For the owner: Advanced's heading "Advanced:
  set colours by hand" and opening line "A colour you set here stays as you set it when you change
  the brand colour, background or corners. Waitron still checks it can be read.", shortened from the
  design's until slice 11; the names given to colours outside the 22 (Error colour, Delete buttons
  switched off, Warning colour, Google button outline, Search highlight, Floor map tables, Table
  card edge) and the folded "zone tab colours"; the two-sentence warning for a colour drawn both
  ways, and the one sentence when it has no fix; the row buttons' spoken names, "Use worked-out
  colour: Page, light screens"; "Brand colour" on Main buttons with Waitron's; and the light form
  of the saved row's "set by hand".

- **A colour picked in Advanced within one animation frame of leaving the editor is lost, and
  nothing asks (A841 slice 6's review, 2026-10-23).** A picker drag sends at most one change per
  frame (`dashboard-theme-advanced`'s `flush`); the Look card's own buttons, Save and Cancel send a
  waiting colour first, but the leave question reads the draft (`current: () => this.draft!` in
  `look-card.ts`) without sending it. A reviewer's probe, with frames held back, saw navigation go
  ahead and no unload warning; Edit on another theme reads the draft the same way (read, not
  tried). Sending the colour inside that read re-enters the draft scope while it reads, so the fix
  is likelier a hook the leave coordinator calls before it compares.

- **The Look card's Fix all button breaks onto two lines ("Fix / all") on a phone (A841 slice 5).**
  It sits in the `.warning` line (`apps/dashboard/src/widgets/fix-line-styles.ts`), where nothing
  stops it shrinking beside the sentence (read, not tried); picture 15 keeps it on one line.
  Measured on the code slice 6 branched from (`de73c6144`, the Look card test rig, two fixable
  warnings): two lines in a card 300 px wide or narrower, one from 320 px. Slice 6's visual check
  saw it at a 390 px window, and slice 6 makes the line more common, since colours set by hand add
  warnings with fixes. The measurement is in slice 6's pull request. In slice 6's shots, slice 5's Undo after
  "Buttons on dark screens: …" wraps onto a line of its own at phone width and starts 12 px in
  (the link button's padding) rather than flush with the line above.

- **Two icons painted in the brand colour sit, in one state each, on a fill no contrast rule checks
  them against (A841 slice 4).** The till's card-waiting spinner on `--wt-color-surface-sunken`
  (Waitron's light blue is 3.28:1 there by the WCAG formula, `#1f6feb` on `#d6d9e0`,
  `packages/ui-core/src/tokens/colors.css:10,14`; a venue theme could go under 3:1), and the data
  table's column-chooser eye icon while its row is dragged, on `--wt-color-surface-lifted`
  (`packages/ui/src/components/wt-data-table.ts:684-688`; read, not measured). The spinner is marked
  decorative beside text saying what is happening, so WCAG 1.4.11 may not ask for 3:1 at all. Decide
  whether the theme's contrast rules should cover either fill.

- **WebKit in CI for A841's start-up checks (lane A ruling, 2026-10-21).** The dashboard's and the
  till's `venue-theme-startup.test.ts` run in Chromium in CI; WebKit was measured once, locally
  (`WAITRON_STARTUP_ENGINES=chromium,webkit`; receipt in `docs/developers/testing-guide.md`). To gate
  it: install WebKit in those shards under a bounded, retried apt step (CLAUDE.md §2), give the
  Playwright cache a key per engine so Chromium-only jobs do not save a cache without WebKit, and set
  the variable for those suites. Whether WebKit's Linux libraries are missing from `ubuntu-latest`
  is an assumption to check first.

- **A dashboard that signs in takes a fresh theme from its live stream alone (A841 slice 3, #1940).**
  Since #1940 the sign-in read reuses the start-up answer from `/api/theme` instead of asking again;
  the live stream's opening read is what picks up anything newer. If that stream neither opens nor
  errors, the start-up answer stays until the query's own refresh, which reading the code puts at
  60 seconds (not measured). Decide whether that is acceptable, or whether sign-in should ask again
  when the start-up answer is older than some bound.

- **A841 slice 13 tidy-ups its review left (#1959's finish-branch, 2026-10-22).** Optional, no
  behaviour change: the switch dialog (`apps/dashboard/src/widgets/theme-switch-dialog.ts`) could be
  built inside the Themes card (`apps/dashboard/src/screens/themes-card.ts`) rather than beside it,
  keeping its guard against a double press; the choice of whether a saved or switched theme repaints
  the page is made in more than one place (`themes-card.ts`, `look-card.ts`) and could be made in
  one; `apps/dashboard/src/widgets/theme-delete.ts` could take a clearer name. The review named three
  smaller tidy-ups the finish-branch report did not list; they were not recorded.

- **A841 slice 3 tidy-ups its review left (#1940's finish-branch, 2026-10-21).** Optional: about
  twenty dashboard test files repeat the same stub setup and could share a helper (the stubs predate
  #1940); the till still checks that the theme hash is a string although its type says so (removing
  it means changing test fixtures); the till's poll skips its theme check while an earlier zone read
  is still out, which only means fewer retries; two result fields of the start-up probe are never
  read; and nothing checks that each app registers the start-up probe.

- **A841 slice 1 tidy-ups its review left (#1927's finish-branch, 2026-10-21).** Optional, no
  behaviour change: `checkRules` (`packages/ui-core/src/theme/contrast-rules.ts`) and `failing`
  (`derive.ts`) both evaluate contrast rules and could share one evaluator; the black-or-white text
  choice could be shared with `packages/ui`; `deriveAt` could be tidied and the hues kept in one
  list; `packages/ui-core/src/tokens/colors.test.ts` still keeps its own station lists rather than
  reading `STATIONS`.

- **Uploaded font files for themes (owner, 2026-10-20, A841 Q7 B) — after A841.** A theme's
  Typeface may also be a font file the venue uploads, so every screen draws the bar's own face. The
  owner asked for it "designed and built after this as their own item". To settle in its own design:
  the licence (the venue must be allowed to serve the font to its own screens; Waitron cannot check
  that), which formats and what size limit, where the files are stored and served (the image library
  takes images only), how a till caches them for a restart without the box, `font-display: swap` so
  no screen waits for a file, registering each font for the whole page (a page-level `@font-face`
  or `document.fonts.add`) so the theme editor's preview can draw it — an `@font-face` inside a
  component's shadow stylesheet does nothing in Chromium 156 (A841 design, section 5a) — and re-running A841's 130% layout cases and hyphenation check in the
  uploaded face. It plugs into A841's seam: the typeface list, `typefaceStack()` and `@font-face`
  ahead of `/api/theme`'s blocks (A841 design, section 5a). Needs A841's slice 11 first.

- **A899. design-system.md's "Retheming a deployment" gives the wrong reason against a bare
  `[data-wt-theme-root]` selector (`docs/developers/design-system.md:108-110`, written when the file
  was created in b20c26709).** It says such a selector "only matches the token layer's own
  specificity", but every token-layer rule is now `:where()`-wrapped, and A841's probe (Chromium
  156, the real `colors.css` adopted as `applyTokens` does) found a bare
  `[data-wt-theme-root] { --wt-color-primary: … }` winning in all six Light / Dark / Follow device ×
  OS light / dark cases. The advice against a bare `[data-theme]` selector holds for another reason:
  Follow device removes the attribute (`packages/ui/src/theme-choice.ts:28`), so such a rule stops
  matching. Next: reword the sentence with the real reasons.

- **A1013. Online booking for customers (owner, 2026-10-22).** A customer books a table from the
  venue's public page. The bookings module serves staff today (A429); this adds the public side:
  the times the venue can take, the customer's booking form, confirmation and reminders. Needs
  remote access (A951). While the box cannot be reached no booking is taken: Waitron Cloud's D88
  proposal keeps no booking queue of its own. Backlog only, not queued to a lane.

- **Bookings**, each greenfield: a CRM entity, recurring bookings, a calendar grid, deposits.

- **Show how many dishes are being made on the table plan — OPEN (3d, W16).** — left open by the
  product folders work. The plan has no such count; adding one needs another value from
  `listTablesWithState`.

- **Refresh the floor without a staff action in a zone's list view — OPEN (3d, W16).** — left
  open by the product folders work. Since A429 slice 3 the floor screen re-reads the floor every
  15 seconds while a zone's map is on screen. Polling would read `listTablesWithState` every few
  seconds on every till; choose the interval and cost first.
  [Detail](backlog/till.md#refresh-the-floor-without-a-staff-action-in-a-zones-list-view--open-3d-w16)

- **Sent does not show an extra's separate kitchen progress** (P6). The service read attaches
  extras under each dish without their own station or kitchen-state fields (`CurrentOrderExtra`
  and `readCurrentOrders`, `apps/server/src/order-groups.ts`). The dish's Ready projection
  already waits for its kitchen components, including a split-off extra, as checked by
  `apps/server/src/current-orders.test.ts`. The open work is showing each extra's own progress;
  `apps/till/src/widgets/sent-orders.ts` currently draws its name and quantity.

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
  such a line marked "Not offered now", and the first edit of the order removes such an extra.
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
    (2026-10-24, A789 slice 2: the period's Keep open button is gone.)
  - In Spanish at 390 wide, the counter's basket line showed no product name in two screenshots of
    the Collect step (light and dark): the row with quantity, price and Note is there, the name row
    above it is missing, not cut off. In English at 390, and in Spanish at 1280, the name shows.
    Seen once; cause not investigated.

- **A table order's draft arrangement draws its line names without the content language's
  `lang`**, so they do not hyphenate (A841 slice 10, D14). Give its `lead-<n>` names the same
  `lang`, `hyphens: auto` and `hyphenate-limit-chars: 8 auto auto` as the bill's `.product-name`
  (`apps/till/src/widgets/basket.ts`). Left open by A841 slice 10b.

- **A wider till gives the bill line's name less room.** On a 1280 × 800 till the name shares its
  row with four controls and keeps 104 px at 100% and 86 px at 130%, while under 360 px of basket
  (a 1024 × 768 till) it takes a row of its own, 307 px wide (`@container (width < 360px)` in
  `apps/till/src/widgets/basket.ts`), so long names wrap to more lines than they need. Left open by
  A841 slice 10b.

- **At 1024 × 768 and 130% the till's top strip hides "Transfers" and "Pass" behind a sideways
  scroll**; at 100% "Pass" is already hidden. Seen in the slice's look check, demo venue. Left open
  by A841 slice 10b.

- **On a 390 px phone the floor map cuts table names short at every text size.** It fits twelve
  tables in squares about 30 px wide, so a name longer than three or four letters shows "Terr…"
  until the map is pinched (the map's `text-overflow: ellipsis`,
  `packages/ui/src/components/wt-floor-map.ts`). Left open by A841 slice 10b.

### Printers, the print agent and receipts

_Formerly A3, A8 and B6; part of A9._ Detail: [backlog/printers.md](backlog/printers.md).

- **A department's Receipts preview shows the theme's logo, for a readable department whose draft names
  no logo, with no words saying it is the venue's** (A841 slice 9, D7 of
  [the plan](superpowers/plans/2026-10-25-a841-9-logo-receipts.md)).

- **A department's Receipts preview does not redraw when the theme in use changes while it is open**
  (A841 slice 9, [the plan](superpowers/plans/2026-10-25-a841-9-logo-receipts.md)).

- **A department's Receipts preview logs nothing when its saved logo's read fails.**
  Pass the same diagnostic, with a test that a failed read warns.
  [Detail](backlog/printers.md#a-departments-receipts-preview-logs-nothing-when-its-saved-logos-read-fails)

- **Half of an older receipt test can no longer fail.**
  Owner's call: delete the old test, or keep only its corrupt-picture half.
  [Detail](backlog/printers.md#half-of-an-older-receipt-test-can-no-longer-fail)

- **A drawer kick for a USB printer that is not connected waits with no expiry**, and is claimed when
  the printer reappears, so the drawer can open long after the sale (`packages/printing/src/runtime.ts`).
  [Detail](backlog/printers.md#a-drawer-kick-for-a-usb-printer-that-is-not-connected-waits-with-no-expiry)

- **Show a failed automatic invoice copy to staff.** A recoverable email or office-printer
  reservation refusal commits the sale with no delivery row or paper fallback; the diagnostic
  is in the server log. Decide how the till should show that outcome and offer another copy.
  [Receipt-branch observation](backlog/printers.md#show-a-failed-automatic-invoice-copy-to-staff)

- **What the AppArmor profile (A129, #862; A134, #887) left open:** **`trust` is still refused.** **The setup page's HTML says nothing about Bluetooth availability** — only `/status.json` and the log do. [Detail](backlog/printers.md#what-the-apparmor-profile-a129-862-a134-887-left-open)

- **A sweep in flight keeps connecting after the discovery window closes.** Pass the deadline
  through `Host.scan`. The office-printer check and the check of addresses typed into the dashboard
  still run inside the poll, so the job pull waits for them (C117, #955).
  [Detail](backlog/printers.md#a-sweep-in-flight-keeps-connecting-after-the-discovery-window-closes)

- **Unpair can come back for a short while after a successful unpairing** — found in C103's review, read, not run. Clearing `pairedAt` when the agent reports a successful unpair, or reports the device unpaired, would end it; the owner was asked (questions.md, C103). [Detail](backlog/printers.md#unpair-can-come-back-for-a-short-while-after-a-successful-unpairing)

- **An agent compares the server's discovery deadline with its own clock** — found in C102, read, not run. An agent on another machine whose clock is out by minutes scans for the wrong span; one on the box shares its clock. [Detail](backlog/printers.md#an-agent-compares-the-servers-discovery-deadline-with-its-own-clock)

- **A department's receipt logo save re-checks only the image's revision, not its id** — found in
  A841 slice 7's review, read, not run.
  [Detail](backlog/printers.md#a-departments-receipt-logo-save-re-checks-only-the-images-revision-not-its-id)

- **A copied department receipt that names `logo` twice, or once more as `"logo\u0000"`, may split
  its two readers** — believed from A841 slice 7's review, not run through a receipt.
  [Detail](backlog/printers.md#a-copied-department-receipt-that-names-logo-twice-or-once-more-as-logou0000-may-split-its-two-readers)

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

- **Waitron carries two QR encoders; consolidate on `qrcode-generator`** — Small.
  [Detail](backlog/printers.md#waitron-carries-two-qr-encoders-consolidate-on-qrcode-generator)

- **Printer lists that still read as empty while loading or after a failed read** — left open by
  A428. [Detail](backlog/printers.md#printer-lists-that-still-read-as-empty-while-loading-or-after-a-failed-read)

- Choose one reset-on-dismiss policy for armed destructive row actions across printers and agents;
  migrate `?disabled=${busy}` buttons to `loading`; the seen-status is as of the last read, not a live
  presence light.

- **Since W72c an imported print agent arrives with no node; the importing box's own agent still
  enrols as a new row beside it**, as it did before (read, not run). Left open by W72c (#1237).

- **Adding a language to the venue also means adding its printer captions, and a language written
  outside the Latin letters means widening the font table.**
  [Detail](backlog/printers.md#adding-a-language-to-the-venue-also-means-adding-its-printer-captions-and-a-language-written-outside-the-latin-letters-means-widening-the-font-table)

- **Loose ends left by C107 (#974).**
  [Detail](backlog/printers.md#loose-ends-left-by-c107-974)

- **Loose ends left by #367.**
  [Detail](backlog/printers.md#loose-ends-left-by-367)

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

- **A552. Invoices on the owner's office printer are unchecked with the committed code.** Check
  the HP Color LaserJet MFP M181fw with a long PDF invoice, measuring and scanning its QR, and
  check what Waitron reports with an empty tray and when power is lost mid-job. Left open by A231q.
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
  [Detail](backlog/printers.md#loose-ends-left-by-a662-1803)

- **A `wt-dialog` (and so `wt-modal`) holding hinted fields is taller inside than it shows (found
  by A662; predates it).**
  [Detail](backlog/printers.md#a-wt-dialog-holding-hinted-fields-is-taller-inside-than-it-shows)

- **Find a bill's pay offers no guests field** (left open by A663 Part 3b). Not decided.
  [Detail](backlog/printers.md#find-a-bills-pay-offers-no-guests-field)

- **Loose ends left by A663 Part 3b (#1827).**
  [Detail](backlog/printers.md#loose-ends-left-by-a663-part-3b-1827)

- **A790. Choose a document and its permitted printer.** The
  [implementation plan](superpowers/plans/2026-10-22-a790-document-printer-routing.md) is
  approved for build (owner, 2026-10-23); implementation waits for A739/G4 recovery gates
  and release of the overlapping paths.
  [Detail](backlog/printers.md#a790-document-and-printer-routing-plan)

- **Loose ends left by A661 (#1745).**
  [Detail](backlog/printers.md#loose-ends-left-by-a661-1745)

- **Loose ends left by A663 Parts 1a, 1b and 2 (#1748, #1756, #1768).**
  [Detail](backlog/printers.md#loose-ends-left-by-a663-parts-1a-1b-and-2-1748-1756-1768)

- Read-back gap: the printer editor cannot change a printer's connection type (`transport`),
  though the API's printer update accepts it (`PATCH /management-api/printers/:id`,
  `apps/server/src/print-api.ts`); nor does it send a USB or Bluetooth `localKey` or a cloud
  `pollId`. A261 step 8 retired the location print-mode and drawer-policy toggles.

- **One "Receipts" settings page, with a live preview (C116, #989; C120, #1000; C121, #996) — still
  open:**
  [Detail](backlog/printers.md#one-receipts-settings-page-with-a-live-preview-c116-989-c120-1000-c121-996--still-open)

- **The Receipts preview redraws the whole receipt once per highlighted part** — left open by W111
  (#1261, the receipt's top block). W111 took the marks from 2 to 6, so one preview can draw the
  receipt up to 7 times, and the screen asks for a preview after each pause in typing. Not measured.
  [Detail](backlog/printers.md#the-receipts-preview-redraws-the-whole-receipt-once-per-highlighted-part)

- **Left open by #1261's review (W111):** database enforcement of logo retention remains open.
  A theme's logo (A841 slice 7) is a second image whose deletion only the app refuses; this entry
  covers it too.
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
  covered")**, as a USB printer no agent sees does. No agent currently reporting the printer as
  visible leaves its jobs waiting.
  [Detail](backlog/printers.md#a-bluetooth-printer-no-agent-reports-paired-still-waits-with-no-reason-on-the-job-a139s-not-covered)

- **RFCOMM always uses channel 1.** Nothing looks up a printer's channel, so a printer whose serial
  port is on another channel fails each job with the connection error.

- **The paired-printer listing can be reused for ten seconds.** A printer unpaired outside the
  agent can still resolve during that window. The window has not been measured on the box.
  [Detail](backlog/printers.md#the-paired-printer-listing-reuse-window)

**Owed at the box — nothing here has run on real hardware:**

- **Photographs and timings of pictures on paper.**
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

- **Printing over RFCOMM from INSIDE the print-agent container (A140).**
  [Detail](backlog/printers.md#printing-over-rfcomm-from-inside-the-print-agent-container-a140)

- **The owner's Bluetooth printer was listed only under Show all devices (A137) — the cause on the
  box is not confirmed.** It needs the fixed image on the box first.
  [Detail](backlog/printers.md#the-owners-bluetooth-printer-was-listed-only-under-show-all-devices-a137--the-cause-on-the-box-is-not-confirmed)

- **A print agent cannot be discarded when the join window shuts (A269, owner 2026-10-04) — OPEN.**
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

- **A960. On an 80 mm roll in Basque, a full invoice with more than one VAT rate prints a full
  comp's «Deskontua 100%» with «100%» on its own line under the figures (left open by A758-4).**
  [Detail](backlog/printers.md#a960-on-an-80-mm-roll-in-basque-a-full-invoice-with-more-than-one-vat-rate-prints-a-full-comps-deskontua-100-with-100-on-its-own-line-under-the-figures-left-open-by-a758-4)

- **A961. On a full invoice, a dish's discount row that no single comp names prints «Descuento
  100%» whenever every line at its rate was filed at zero (left open by A758-4).**
  [Detail](backlog/printers.md#a961-on-a-full-invoice-a-dishs-discount-row-that-no-single-comp-names-prints-descuento-100-whenever-every-line-at-its-rate-was-filed-at-zero-left-open-by-a758-4)

- **Loose ends left by A331 batch 3b (#1415).**
  [Detail](backlog/printers.md#loose-ends-left-by-a331-batch-3b-1415)


### Payments and card readers

- **A1089: charged-but-unsettled and repeated payment-check failures need a recovery route.** Trace the existing pending-payment recovery and reason-specific messages, then offer only confirmed-outcome actions. Never retry a charge or unlock an unknown outcome.
  [Audit](backlog/self-service-refusals.md#payments).

_Formerly A6, and the old Track C's payments items; part of A9._ Detail: [backlog/payments.md](backlog/payments.md).

- **A742 — the guest types what they pay, and a tip (owner, 2026-10-15; on the backlog, NOT to be
  queued yet).** A flow where staff hand the device to the customer, who enters how much they want
  to pay of the bill and optionally adds a tip, then hands it back or pays on the reader. Builds on
  A739's payment window (An amount) and the bill payments design's tips. Not designed.

- **Two concurrent passes over `listAttempting` (`packages/payments/src/store.ts`; its one caller is
  the SumUp provider's `resolvePending`) do not both succeed**: the second pass throws partway
  instead of skipping the rows the first resolved.
  [Detail](backlog/payments.md#two-concurrent-passes-over-listattempting-packagespaymentssrcstorets-its-one-caller-is-the-sumup-providers-resolvepending-do-not-both-succeed)

- **Loose ends left by A633.**
  [Detail](backlog/payments.md#loose-ends-left-by-a633)

- **The Stripe webhook endpoint still has to be repointed by hand, at Stripe** — left behind by the
  tenant-column removal (#378, 2026-09-16). **Next action:** change it in the Stripe dashboard
  before any card payment is taken through a Stripe webhook.
  [Detail](backlog/payments.md#the-stripe-webhook-endpoint-still-has-to-be-repointed-by-hand-at-stripe)

- **Lift `reverseViaStripe` and `reverseViaSumUp` into one neutral reversal primitive.**
  Left open by A632.
  [Detail](backlog/payments.md#lift-reverseviastripe-and-reverseviasumup-into-one-neutral-reversal-primitive)

- **Turn off Stripe's on-reader tip screen, or read the tip back.** Backlog only; SumUp is the
  go-live provider (owner, 2026-10-21). Next: pass `process_config[skip_tipping]=true` from
  `processPaymentIntent`, tested against Stripe's sandbox. Left open by A846.
  [Detail](backlog/payments.md#turn-off-stripes-on-reader-tip-screen-or-read-the-tip-back)

- **The payments check ignores the currency Stripe reports.** `stripeReportClient` never reads
  `bt.currency`. Left open by A846.
  [Detail](backlog/payments.md#the-payments-check-ignores-the-currency-stripe-reports)

- **A846's points for the owner at land: held card payments.** A kept payment has no invoice, the
  held alert comes back at midnight UTC, and smaller choices from the plan, the browser look and the review. Each stays open until the owner
  answers it. [Detail](backlog/payments.md#a846s-points-for-the-owner-at-land-held-card-payments)

- **The reconciler's card reversal records only after the provider call, with a fresh key each time.**
  Next: give the reconciler's reversal the same durable-attempt rule.
  [Detail](backlog/payments.md#the-card-refund-path-records-only-after-the-provider-call-with-a-fresh-key-each-time)

- **Loose ends left by B28's review (#1005), not acted on, under service Task 17 (#991).**
  Next: a route case sending `tip: null` to `POST /api/pay`, then decide refuse or accept.
  A stale card-attempt mark after a free sale also remains unchecked (read, not run).
  [Detail](backlog/payments.md#loose-ends-left-by-b28s-review-1005-not-acted-on-under-service-task-17-991)

- **A placed order with no invoice is not checked against stored card payments when it is
  cancelled.** Left open by C126.
  [Detail](backlog/payments.md#a-placed-order-with-no-invoice-is-not-checked-against-stored-card-payments-when-it-is-cancelled)

- **Task 4 (#832, every paper names all of a party's tables).** Not yet checked: the payment API's
  `/management-api/payments/stuck`, `/management-api/payments/bill-payments` and
  `/management-api/payments/bill-refunds` queries, which read the same column.
  [Detail](backlog/payments.md#task-4-832-every-paper-names-all-of-a-partys-tables)

- **A875. Check two writes the bill payments design says a pending card refund refuses.**
  Next: one route case each during a pending refund, then fix the design's wording, or the code
  if a move can change what a bill charges (ask the owner first). Read, not run.
  [Detail](backlog/payments.md#a875-check-two-writes-the-bill-payments-design-says-a-pending-card-refund-refuses)

- **The SumUp Solo experiments.** Still open: supplied-reference lookup and deduplication, actual
  webhook headers, signature-card handling, and fresh full/partial-refund observations. Bring the
  Solo online with the operator and follow the checklist; A949's 2026-10-22 checkpoint is in detail.
  [Detail](backlog/payments.md#the-sumup-solo-experiments)

- **The deli's outage card machine.** Buy the standalone machine and
  replace estimated prices with real quotes.
  [Detail](backlog/payments.md#the-delis-outage-card-machine)

- **The printer-cradle experiment** (hardware not yet owned). SumUp's OpenAPI has no `print` and no
  receipt option on a reader checkout, so we can neither request nor suppress a cradle slip. State the
  failing case first (the cradle stays silent), with a standalone payment as the control. Also unread:
  `GET /v1.1/receipts/{transaction_id}`, richer than the four fields the adapter keeps.

- **What #329 left open:** adding or adopting a reader does not shut out a provider disconnect at the
  same moment (an accepted race); Stripe's reader list is one page; status never refreshes by
  itself, and polling must go through the passive-session controller.

- **The SumUp reconciler** — settlement-report audit and orphan self-heal. A949 also includes
  durable reversal attempts (W44) and the owner's backup-machine matching contract. Its experiment
  checkpoint leaves the live reference and refund-unit questions open.
  [Detail](backlog/payments.md#the-sumup-reconciler)

- **A SumUp API drift-detection suite** on a Virtual Solo in a sandbox merchant account — would have
  caught the #312 refund-unit bug. Needs a sandbox account and a CI secret.

- **Stripe does not fill `CardDetails`**, so a Stripe card sale prints `Tarjeta` with no scheme/PAN/
  auth. Gated on the deli having a Stripe account, which it does not.


- **Restore `stripe_on_device` (Tap-to-Pay) on the handheld** (left open by A796). It waits for
  the one-time native-app decision
  ([native app capabilities](superpowers/specs/2026-08-30-native-app-capabilities.md), N1/N2;
  [A796 design §6](superpowers/specs/2026-10-19-a796-handheld-payments-design.md#6-tap-to-pay)).

- **Name the printer on the paid screen's ticket line** (left open by A796, its default 12). The
  route that answers the paid screen would have to return the print job's printer, which
  `readOriginalReceiptPrints` (`apps/server/src/receipt-print.ts:437`) joins but does not hand back.

- **Check paying at the table on the OnePlus 13 at the box's address** (left open by A796). A
  reader card, a QR scan and an NFC tap from the pay sheet, and the NFC button's permission ask;
  the browser tests use fakes for all four.

- **A user guide for the till's payment sheet** (left open by A796). No guide under
  `apps/server/src/guide/` covers it.

- **The next identical bill payment can be answered with one that got a server error** (narrowed
  by A796). What is left: a first send answered with a 5xx or an error with no code keeps its
  submission without holding the bill, so the second guest's identical payment may be replayed.
  [Detail](backlog/payments.md#the-next-identical-bill-payment-can-be-answered-with-one-that-got-a-server-error)

- **A796 does not hold a bill across phones while a payment is out.** The hold is the phone's own:
  "no new payment … can be started on that bill from this phone" (A796 design §4, "The phone loses
  Wi-Fi mid-payment", and default 7). The server is unchanged, so another phone can start a
  payment on the same bill meanwhile.

- **A payment whose read shows it settled the bill needs one press of Comprobar de nuevo to show
  the ticket.**
  [Detail](backlog/payments.md#a-payment-whose-read-shows-it-settled-the-bill-needs-one-press-of-comprobar-de-nuevo-to-show-the-ticket)

- **Check first: on a venue with no fiscal module, replaying a settled bill may throw** (read, not
  run; found by A796's Task 23 review). First run a replay on such a venue to see whether it is reached.
  [Detail](backlog/payments.md#check-first-on-a-venue-with-no-fiscal-module-replaying-a-settled-bill-may-throw)

- **On a venue with no fiscal module, a handheld shows the ticket view after a presented bill is
  paid, not the paid screen** (known limit of A796; read, not run).
  [Detail](backlog/payments.md#on-a-venue-with-no-fiscal-module-a-handheld-shows-the-ticket-view-after-a-presented-bill-is-paid-not-the-paid-screen)

- **Loose ends left by W102 (NFC and equipment labels).**
  [Detail](backlog/payments.md#loose-ends-left-by-w102-nfc-and-equipment-labels)

- **The webhook `recordSale` hand-off** (Mode 3) and the reconcile remediation UI. The hand-off sits
  BEHIND the `AsyncPaymentProvider` seam and is therefore provider-neutral — building it against the
  Stripe Checkout adapter that already exists forecloses no cheaper provider later.

- **A guest paying from their own phone** (owner idea 2026-09-18, parked; the surface it needs does
  not exist). This is now the payment part of A508; the ordering surface is A508 and A509.
  [Detail](backlog/payments.md#a-guest-paying-from-their-own-phone)

- **Routing by BILL SIZE is allowed but is the smallest lever** (owner idea 2026-09-18, arithmetic
  in the research note). The card mix moves the crossover further than the bill size does, and
  the deli's own mix is a query once it trades, not a research question.
  [Detail](backlog/payments.md#routing-by-bill-size-is-allowed-but-is-the-smallest-lever)

- **Some card payments ask the cardholder to sign instead of enter a PIN — open question, nothing
  built.** Start by reading what the SumUp Solo actually does on a signature-required card,
  because if the reader owns the whole step there may be nothing for us to build.
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
  [Detail](backlog/payments.md#a793--tips-who-a-tip-belongs-to-how-it-is-shared-out-and-what-payroll-gets)

- **A whole-order card payment does not refuse a negative tip** (found by A793's design, read,
  not run). A tip with more than two decimals is not checked either. Next: a route case sending
  `tip: "-5.00"`, then refuse it before the reader is asked. A793's slice 1. Full review (money).
  [Detail](backlog/payments.md#a-whole-order-card-payment-does-not-refuse-a-negative-tip)

- **A whole-order payment records the amount it expected, not the amount captured** (found by
  A793's design, read). Next: compare the captured amount at capture time, as the bill payment
  loop does (`payment.bill_capture_mismatch`).
  [Detail](backlog/payments.md#a-whole-order-payment-records-the-amount-it-expected-not-the-amount-captured)

- **Three small tip display gaps** (found by A793's design, read): the dashboard's order detail
  shows a bill payment's applied amount without its tip; the card slip's words are fixed Spanish;
  and the Spanish refund slip says "Propina" where the English says "Tip returned".
  [Detail](backlog/payments.md#three-small-tip-display-gaps)

- **A848. Show a clear message when the till pays, sends or moves an empty order.**
  [Detail](backlog/payments.md#a848-show-a-clear-message-when-the-till-pays-sends-or-moves-an-empty-order)

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
  while the card's charge stays on no sale. Measured before A526 through an unpaid departure
  that A526 now refuses; no other way to reach it is known. Left open by A526.
  [Detail](backlog/payments.md#finalizecaptures-duplicate-fallback-can-show-a-receipt-for-an-order-that-is-not-settled)

- **An offline card payment that forwarding moved to `settled` with no sale no longer holds its
  placed order**: once no card payment of the order runs in this process, a collect is accepted.
  Left open by A526.
  [Detail](backlog/payments.md#an-offline-card-payment-that-forwarding-moved-to-settled-with-no-sale-no-longer-holds-its-placed-order)

### Users, sign-in and the dashboard shell

- **A1089: account-access recovery needs an authenticated decision when no offered sign-in works.**
  The passkey refusal offers retry, password entry and an emailed password reset. These do not
  reactivate a disabled account or replace unavailable email delivery. Design a recovery choice
  that offers any required administrator sign-in at the refusal, preserves account privacy and
  explains its effect before changing access.
  [Correction](backlog/self-service-refusals.md#sign-in).

Detail: [backlog/dashboard.md](backlog/dashboard.md).

- **Spacing for buttons grouped beside Cancel belongs in `wt-form-actions`.** The
  `[Cancel] [Delete…] … [Save]` row (design-system.md → Forms) has each dialog space its own group;
  move it into `packages/ui/src/components/wt-form-actions.ts`. Left open by A719 (#1838).

- **A901. The shared reorder announcement misreads an item name holding `$&` or `{index}` (found in
  A757 slice 7's review, 2026-10-19).**
  [Detail](backlog/dashboard.md#a901-the-shared-reorder-announcement-misreads-an-item-name-holding--or-index-found-in-a757-slice-7s-review-2026-10-19)

- **A905. The department dialog can take back another manager's older copy of the venue after a save
  (found in A757 slice 7's review, 2026-10-19).**
  [Detail](backlog/dashboard.md#a905-the-department-dialog-can-take-back-another-managers-older-copy-of-the-venue-after-a-save-found-in-a757-slice-7s-review-2026-10-19)

- **An off `wt-switch` is hard to see, worst in a dark dialog (seen in A757 slice 1's look,
  2026-10-19).**
  [Detail](backlog/dashboard.md#an-off-wt-switch-is-hard-to-see-worst-in-a-dark-dialog-seen-in-a757-slice-1s-look-2026-10-19)

- **A781. One shared panel-placement and arrow-key helper for the `wt-*` pop-up fields (left open by
  #1828).**
  [Detail](backlog/dashboard.md#a781-one-shared-panel-placement-and-arrow-key-helper-for-the-wt--pop-up-fields-left-open-by-1828)

- **The box's trust page and the favicon still follow the device's setting, not the Theme choice
  (left open by A681).**
  [Detail](backlog/dashboard.md#the-boxs-trust-page-and-the-favicon-still-follow-the-devices-setting-not-the-theme-choice-left-open-by-a681)

- **Five tidy-ups A681's review left for later (#1842, 2026-10-17).**
  [Detail](backlog/dashboard.md#five-tidy-ups-a681s-review-left-for-later-1842-2026-10-17)

- **A653 — every long dashboard table scrolls the same way, with less above it (owner, 2026-10-14;
  open).**
  [Detail](backlog/dashboard.md#a653--every-long-dashboard-table-scrolls-the-same-way-with-less-above-it)

- **A657 — Cancel leaves without asking (owner, 2026-10-14; open).**
  [Detail](backlog/dashboard.md#a657--cancel-leaves-without-asking)

- **A625. Check whether a row menu still wraps its two-word items after the window is resized to
  phone width (owner, 2026-10-17: keep as a check).**
  [Detail](backlog/dashboard.md#a625-check-whether-a-row-menu-still-wraps-its-two-word-items-after-the-window-is-resized-to-phone-width-owner-2026-10-17-keep-as-a-check)

- **A582. Help mode: a "?" in the top bar marks everything that has help (owner 2026-10-13)** — approved; kitchen screens and monitors, payment help after A739, and the remaining shared-help follow-ups stay open.
  [Detail](backlog/dashboard.md#a582-help-mode-a--in-the-top-bar-marks-everything-that-has-help-owner-2026-10-13)

- **`wt-combobox` without a search box never exposes `aria-required`**
  [Detail](backlog/dashboard.md#wt-combobox-without-a-search-box-never-exposes-aria-required)

- **A1069. Venue settings keeps a `kitchen` tab key with no panel (owner question).** The key in
  `VENUE_SETTINGS_TABS` (`apps/dashboard/src/screens/venue-settings-screen.ts`) lets the page's tab
  checks keep a second tab; say if it should go (about 25 cases then lose their subject) — plan
  A756 PR 8 Decision 10.

- **A1058. A `wt-combobox` list with no room below its field covers the field's own value.**
  `positionPopup` (`packages/ui/src/components/wt-combobox.ts`) pulls the list up only as far as
  the window needs, never above the field: at a 900 px-tall window the station editor's last field,
  Changes after sending, opens its list over its own value and the Save button (A756 PR 8's look).

- **In the Customise dialog, a released column row jumps into its slot instead of sliding.** The
  house rule for a dragged row (design-system.md, the `--wt-color-surface-lifted` paragraph) has it
  slide into its slot over `--wt-duration-move`; here every row lands at once (`#endColumnDrag`,
  `packages/ui/src/components/wt-data-table.ts`). Left open by A499.

- **Loose ends left by signing a dashboard tab out when its box has been reset (A485, #1545).**
  [Detail](backlog/dashboard.md#loose-ends-left-by-signing-a-dashboard-tab-out-when-its-box-has-been-reset-a485-1545)

- **Loose ends left by A501 (#1552).**
  [Detail](backlog/dashboard.md#loose-ends-left-by-a501-1552)

- **A398 — device-profile editor heading remains to align with the sub-page pattern.**
  [Detail](backlog/dashboard.md#a398--device-profile-editor-heading-remains-to-align-with-the-sub-page-pattern)

- **`date-utils.test.ts` has a test titled as guarding "against a vacuous pass"**
  [Detail](backlog/dashboard.md#date-utilstestts-has-a-test-titled-as-guarding-against-a-vacuous-pass)

- **`reorder.test.ts`'s test names say an out-of-range move "clamps"; `reorder()` ignores it.**
  Found by #610 (`apps/dashboard/src/api` + `src/widgets`), not fixable in a comments-only change.

- **`setEmail` in `packages/identity/src/staff.ts`, unlike `updatePersonDetails`, never checks the
  new email against other people's pending emails**
  [Detail](backlog/dashboard.md#setemail-in-packagesidentitysrcstaffts-unlike-updatepersondetails-never-checks-the-new-email-against-other-peoples-pending-emails)

- **Dashboard leftovers from the coverage branch**
  [Detail](backlog/dashboard.md#dashboard-leftovers-from-the-coverage-branch)

- **A person row written from outside `packages/identity` still folds its key ASCII-only** — OPEN.
  [Detail](backlog/dashboard.md#a-person-row-written-from-outside-packagesidentity-still-folds-its-key-ascii-only)

- **Should an all-archived product selection show Archive greyed out rather than hidden?**
  Left open by W110c (#1271); A435-1 removes Enable and keeps Archive hidden for that selection.

- The dashboard's `es-ES` module default still needs the flip the till got in #170.

- **Task 1b** (#554, session cookies stored only as hashes).
  [Detail](backlog/dashboard.md#task-1b-554-session-cookies-stored-only-as-hashes)

- **Quantity-display follow-ups found while tracing A313, OPEN, unqueued:** the Top sellers table
  renders its quantity strings directly (`apps/dashboard/src/widgets/top-sellers-table.ts`), and the
  till's `trimQuantity` removes trailing zeros without localising a fraction's decimal mark. These
  are readings, not browser reproductions; reproduce them before changing their displays.

- **At 1280 px and 130% the Overview's Top sellers card cuts "Octopus" and "Croquetas" short with
  "…"** (a 66 px box; they need 73 and 90 px); they fit at 100% and at 390 px. The ellipsis for long
  words is A829's rule; the column is what gets too narrow. Left open by A841 slice 10b.

- **Loose ends left by W79 (#1186, the Menus list).**
  [Detail](backlog/dashboard.md#loose-ends-left-by-w79-1186-the-menus-list)

- **Loose ends left by A629 (#1684).**
  [Detail](backlog/dashboard.md#loose-ends-left-by-a629-1684)

- **Loose ends left by W83's review (#1193), not started.**
  [Detail](backlog/dashboard.md#loose-ends-left-by-w83s-review-1193-not-started)

- **A895. A dialog footer's long form message: the field it hides, its scroll cue and its name.**
  [Detail](backlog/dashboard.md#a895-a-dialog-footers-long-form-message-the-field-it-hides-its-scroll-cue-and-its-name)

- **A903. Check that the course list's row menus stay on screen at 390 px (left open by A827).**
  [Detail](backlog/dashboard.md#a903-check-that-the-course-lists-row-menus-stay-on-screen-at-390-px-left-open-by-a827)

- **A904. Correct the list of users in `--wt-cell-name-max-width`'s comment
  (`packages/ui-core/src/tokens/structure.css`) (left open by A827, #1889).**
  [Detail](backlog/dashboard.md#a904-correct-the-list-of-users-in---wt-cell-name-max-widths-comment-packagesui-coresrctokensstructurecss-left-open-by-a827-1889)

- The reasons screen keeps its own copy of the role list and role names
  [Detail](backlog/dashboard.md#the-reasons-screen-keeps-its-own-copy-of-the-role-list-and-role-names)

- **Override PIN limits (C89, #951), for the owner** — **Next action:** the owner decides whether to
  add the countdown and make the limit required. Left open by service Task 11 (#916).
  [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- On the dashboard, the account menu (which since A582's slice 2b also holds the signed-in language
  [Detail](backlog/till.md#task-16-981-counter-handover-with-b25-b26-b29-b30)

- **A keydown guard that cancels Escape while a save runs did not keep one dialog open.** Why that
  screen behaved differently has not been established. Left open by the service, ordering and
  billing plan (Task 1's reasons screen).
  [Detail](backlog/dashboard.md#a-keydown-guard-that-cancels-escape-while-a-save-runs-did-not-keep-one-dialog-open)

- **Left in the dashboard Orders plan and spec after #1034 landed beside C126:**
  [Detail](backlog/dashboard.md#left-in-the-dashboard-orders-plan-and-spec-after-1034-landed-beside-c126)

- **The dashboard shell restyle (#333) has not been checked on hardware.** It was only ever checked
  in screenshots on a desktop browser; nobody has walked it on the real box or a phone, so the
  narrow-viewport banner and drawer are unverified. That walk belongs with the display walkthrough
  in [ui-review.md](ui-review.md).

- **The older collapse-only sidebar test still needs a useful assertion (C35, #822) — OPEN.**
  Find a collapse-only case that needs the app's correction before changing or retiring that test.
  [Detail](backlog/dashboard.md#the-older-collapse-only-sidebar-test-still-needs-a-useful-assertion-c35-822--open)

- **What C38 left as it was (a generated display name is the first given name and first surname,
  #827, owner decision 2026-09-28).**
  [Detail](backlog/dashboard.md#what-c38-left-as-it-was-a-generated-display-name-is-the-first-given-name-and-first-surname-827-owner-decision-2026-09-28)

- **Every `wt-data-table` list lets each person choose its columns (C45, #834) — left open:**
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
  [Detail](backlog/dashboard.md#loose-ends-left-by-c47-838839840841)

- **Request refusals that still land in the bottom message, or under a field in generic words — OPEN
  (left by C54, #853).**
  [Detail](backlog/dashboard.md#request-refusals-that-still-land-in-the-bottom-message-or-under-a-field-in-generic-words--open-left-by-c54-853)

- **Every login failure is one answer (C95, #930, owner decision 2026-09-30)**
  [Detail](backlog/dashboard.md#every-login-failure-is-one-answer-c95-930-owner-decision-2026-09-30)

- **The profile's "Current password" fills the signed-in person's saved password (C98, #934) — still
  open:**
  [Detail](backlog/dashboard.md#the-profiles-current-password-fills-the-signed-in-persons-saved-password-c98-934--still-open)

- **A new passkey is listed under the person's email, with their name as its display name (C99,
  #939) — still open:** the result has not yet been seen in a password manager.
  [Detail](backlog/dashboard.md#a-new-passkey-is-listed-under-the-persons-email-with-their-name-as-its-display-name-c99-939--still-open)

- **The passkey list says when each passkey was last used and which password manager holds it (C100,
  #945) — known limits:**
  [Detail](backlog/dashboard.md#the-passkey-list-says-when-each-passkey-was-last-used-and-which-password-manager-holds-it-c100-945--known-limits)

- **The browser's password manager is told which passkeys Waitron still accepts (C101, #948) — still
  open:** not observed in a real password manager — the tests replace the browser's methods.
  [Detail](backlog/dashboard.md#the-browsers-password-manager-is-told-which-passkeys-waitron-still-accepts-c101-948--still-open)

- **A403 — sign-in and passkey fixes (owner, 2026-10-08; open; low priority; not queued — owner
  2026-10-08: take it from here when a lane has room):**
  [Detail](backlog/dashboard.md#a403--sign-in-and-passkey-fixes-owner-2026-10-08-open-low-priority-not-queued--owner-2026-10-08-take-it-from-here-when-a-lane-has-room)

- **Review every permission: fewer, coarser, and consistently named**
  [Detail](backlog/dashboard.md#review-every-permission-fewer-coarser-and-consistently-named)

- **A1002: custom roles and a built-in Admin that holds every privilege.** Awaiting owner approval.
  [Detail](backlog/dashboard.md#roles-are-something-an-admin-can-add-and-edit-the-four-built-ins-are-only-defaults)

- **Dropdowns sort by the label the person reads, with `Intl.Collator`; a list in a lifecycle order
  says so**
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
  one has not.**
  [Detail](backlog/dashboard.md#typed-values-are-only-partly-checked--a-generic-phone-format-check-landed-a-country-specific-one-has-not)

- Still open from #298/#305/#317, device checks before deployment
  [Detail](backlog/dashboard.md#still-open-from-298305317-device-checks-before-deployment)

- **Three older dashboard screens name languages with their own code rather than
  `languageDisplayName` (`packages/shared`)** — left open by C114 (#1022, a copy printed in another
  receipt language): one of two tidy-ups its review raised and left, because each changes files
  outside it.

- **Loose ends left by secret checks and the write lock (W1, #1117; #912's review).**
  [Detail](backlog/dashboard.md#secret-checks-and-the-write-lock-the-pin-manager-login-and-profile-checks-moved--done-w1-1117-two-blocking-derivations-and-one-stale-answer-window-remain-open)

- **A refused early dashboard payment authorization may become allowed before the PIN transaction —
  UNVERIFIED (A530 review).** `managerPinToCheck` (`apps/server/src/payments-api.ts`) returns no
  credential when its read refuses; `pinGated` then opens the transaction without a turn.
  [Detail](backlog/dashboard.md#a-refused-early-dashboard-payment-authorization-may-become-allowed-before-the-pin-transaction--unverified-a530-review)

- **Ongoing — the dashboard UI overhaul, screen by screen.**
  [Detail](backlog/dashboard.md#ongoing--the-dashboard-ui-overhaul-screen-by-screen)

- **Open, and it bites this work first: two documents state the component rules and they have
  drifted**
  [Detail](backlog/dashboard.md#open-and-it-bites-this-work-first-two-documents-state-the-component-rules-and-they-have-drifted)

- **Nothing stops the next screen styling `wt-data-table` cell markup with a class.** A check that
  compares the class names a screen's own stylesheet styles against the class names it puts inside
  `wt-data-table` cell callbacks looks feasible; nobody has tried to write it. Left open by product
  categories (#340).

- **The colour field's Custom square (`apps/dashboard/src/widgets/color-field.ts`, left by C25).**
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

- **A deployment that overrides `--wt-color-primary` or `--wt-color-danger` by hand keeps Waitron's
  default hover, text and disabled colours, and no theme writes the danger ones**
  [Detail](backlog/dashboard.md#a-deployment-that-overrides---wt-color-primary-or---wt-color-danger-by-hand-keeps-waitrons-default-hover-text-and-disabled-colours)

- **One earlier Spanish dark-theme 390 px demo probe reached its 12-second deadline before the
  bottom**
  [Detail](backlog/dashboard.md#one-earlier-spanish-dark-theme-390-px-demo-probe-reached-its-12-second-deadline-before-the-bottom)

- **A password manager filling the profile's current-password field** — the owner tried Chrome's
  password manager on 2026-10-08 and reported that it works well; other password managers are
  untried. Left open by A331 batch 3a (#1401).

- **Other purchases-screen and staff-screen tests still send made-up create and update
  events** (`create-purchase`, `update-purchase`, `create-person`, `save-person`)
  instead of pressing the form's button; they pass, but never prove the button works. Left open by
  A331 batch 3a (#1401).

- **A542. An open `wt-dialog` moved in the page stays open but is no longer modal** — OPEN.
  [Detail](backlog/dashboard.md#a542-an-open-wt-dialog-moved-in-the-page-stays-open-but-is-no-longer-modal)

- **In a text field inside a dialog, with the field's text selected, End and Home do not move the
  caret**, so typing replaces the whole text. Seen on the A721 branch in the Seasons window and the
  period dialog; a bare input and a bare dialog in the same Chromium behave normally. Cause not
  found; not tested on main.

- **On a hovered Products row in the dark theme, status and allergen badge borders appear to
  disappear into the row** — the earlier screenshot-only observation remains open. Contrast for those
  borders and the prep stations screen remains unmeasured. Left open by
  A319 (hover contrast after A306, #1347).

- **Text size after A179 (#988).**
  [Detail](backlog/dashboard.md#text-size-after-a179-988)

- **Dragging a row (A180, #994 and #1003) — two things seen, left as they were.**
  [Detail](backlog/dashboard.md#dragging-a-row-a180-994-and-1003--two-things-seen-left-as-they-were)

- **Two texts still use the old words.** A hint says "Create" (the Products screen's empty prompt,
  "Create a menu on the Menus screen…"), and the purchase dialog's edit heading reads "Edit
  purchase invoice" while its create heading is now "Add invoice". Left open by A450 (#1484).

- **Opening hours' create texts say "New …" and "+ …"**
  [Detail](backlog/dashboard.md#opening-hours-create-texts-say-new--and--)

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
  sets `activatesRow: false`**
  [Detail](backlog/dashboard.md#a890-a-tree-wt-data-table-draws-a-rows-activator-in-its-first-column-even-when-that-column-sets-activatesrow-false)

### Interface languages

_Formerly entries spread across the old sections, C125 among them; part of A9._ Detail: [backlog/languages.md](backlog/languages.md).

- **Spanish calls the manager role «gerente» in the guide and README, and «Encargado» on screen.**
  [Detail](backlog/languages.md#spanish-calls-the-manager-role-gerente-in-the-guide-and-readme-and-encargado-on-screen)

- **A1076. Spanish names the three late flags three ways**.
  Left open by A756 PR 5.
  [Detail](backlog/languages.md#a1076-spanish-names-the-three-late-flags-three-ways)

- **A887. Find a bill's state filter still says "Held" for an order the till now calls parked.**
  [Detail](backlog/languages.md#a887-find-a-bills-state-filter-still-says-held-for-an-order-the-till-now-calls-parked)

- **A886. Dashboard wording: "Disabled product", "Menús", and two strings nothing reads.**
  [Detail](backlog/languages.md#a886-dashboard-wording-disabled-product-menús-and-two-strings-nothing-reads)

- **The dashboard's locale lookup reads inherited properties.**
  [Detail](backlog/languages.md#the-dashboards-locale-lookup-reads-inherited-properties)

- **The recovery page's Spanish has not been read by a native speaker.**

- **The adjustment-reason and venue delete windows still use older settings, work and loading
  wording.**
  [Detail](backlog/languages.md#the-adjustment-reason-and-venue-delete-windows-still-use-older-wording)

- **The file pickers' "Choose File / No file chosen" follow the browser's language**, not the
  chooser; the browser draws them.

- **The till's Spanish catalogue guard does not scan error-code messages or allergen names.**
  [Detail](backlog/languages.md#decisions-and-deliberate-limits)

- **Catalan, Valencian, Galician and Basque — the receipt's words checked, and the whole app in all
  four (C125) — PARKED by the owner.**
  [Detail](backlog/languages.md#catalan-valencian-galician-and-basque--the-receipts-words-checked-and-the-whole-app-in-all-four-c125-owner-2026-10-02--parked)

- **Future-tense lines outside the delete windows were left alone.**
  [Detail](backlog/languages.md#future-tense-lines-outside-the-delete-windows)

- **The payment slip was left alone.** See A964 and A965.
  [Detail](backlog/languages.md#the-payment-slip-was-left-alone)

- **The translations need a native or official check.**
  [Detail](backlog/languages.md#the-translations-need-a-native-or-official-check)

- The till's on-screen ticket writes a Galician or Basque sale's amounts and date the Spanish way,
  while its words are Galician or Basque.
  [Detail](backlog/languages.md#the-tills-on-screen-ticket-writes-a-galician-or-basque-sales-amounts-and-date-the-spanish-way)

- The printed Basque date is the formatter's own pattern, «2026(e)ko urt. 15(a)», and on 58 mm
  paper it drops to its own line wherever it prints in words.

- The sample receipt the preview draws keeps its Spanish content («Mesa 6», «MUESTRA/1»,
  «Café y tostada») in every language; only its fixed words change. A965 asks whether that stays.

### Alerts, logging and diagnostics

_Formerly A5, and the logging part of A9._ Detail: [backlog/alerts.md](backlog/alerts.md).

- **The alert registry's per-source savepoint has no test that fails without it.** Removing the
  savepoint in `readOpenAlerts` (`apps/server/src/alerts.ts`) left every test that reaches it
  passing, and it reads each source's answer after the savepoint closes. Found by A798-B slice 4
  (#1958).
  [Detail](backlog/alerts.md#the-alert-registrys-per-source-savepoint-has-no-test-that-fails-without-it)

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

- **A982. Logging Slice 2 — one-touch bug report.** The
  [implementation plan](superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md) splits the
  build into trail privacy hardening, frozen local reports with manager read/download, then the
  shared dialog and app buttons, including setup. Planning only; all three implementation PRs
  remain open. Cloud forwarding and automatic crash/freeze reporting remain separate follow-ups.
  [Detail](backlog/alerts.md#logging-diagnostics--one-touch-bug-report-a9-slice-1-landed-192).

- **A1047. Send a problem report to Waitron Cloud (owner, 2026-10-24).** The follow-up A982
  leaves open.
  [Detail](backlog/alerts.md#a1047-send-a-problem-report-to-waitron-cloud).

- **A1048. Opt-in automatic error reports to Waitron Cloud (owner, 2026-10-24: "Should be opt
  in").** Setup asks plainly, unticked; settings can change it.
  [Detail](backlog/alerts.md#a1048-opt-in-automatic-error-reports-to-waitron-cloud).

- **The Alerts table makes long station warnings hard to read on a phone.** — left open by the
  product folders work. Give the alert text more room at phone width while keeping its handling
  action reachable.
  [Detail](backlog/alerts.md#the-alerts-table-makes-long-station-warnings-hard-to-read-on-a-phone)

- **A provider call that ignores cancellation may continue after the server has answered**; the
  source's five-minute cache shares that in-flight call with reads during its lifetime. Left open
  by the A258 follow-up (the alerts list's battery check has its own deadline, W58, #1176).

- **The alert pop-up can split a written time across two lines.** Left open by A798-B slice 9
  (#2025). [Detail](backlog/alerts.md#the-alert-pop-up-can-split-a-written-time-across-two-lines)

### Working time and staff

_Formerly A10; part of A9._ Detail: [backlog/workforce.md](backlog/workforce.md).

- **A851. Staffing reads the venue's first business-day start, not the one in force (found by A788's
  design).**
  [Detail](backlog/workforce.md#a851-staffing-reads-the-venues-first-business-day-start-not-the-one-in-force-found-by-a788s-design).

- **A780. The staffing painters read holder names they never show (left open by #1828).**
  [Detail](backlog/workforce.md#a780-the-staffing-painters-read-holder-names-they-never-show-left-open-by-1828).

- **A763 point 9. The Staffing month's Monday "Rota for this week" link goes, and the Rota tab
  opens the week last picked (owner, 2026-10-16).** Waits for the second part of A724.
  [Detail](backlog/workforce.md#a763-point-9-the-staffing-months-monday-rota-for-this-week-link-goes).

- **A link look for `wt-button` (left open by #1841).**
  [Detail](backlog/workforce.md#a-link-look-for-wt-button-left-open-by-1841)

- **Staffing's day box: each area's staff roles and times.**
  [Detail](backlog/workforce.md#staffings-day-box-each-areas-staff-roles-and-times)

- **Wages / labour cost (SP16).** Gated on the labour advisor; not fiscal.
  [Detail](backlog/workforce.md#wages--labour-cost-sp16).

- **Inspector remote access to working-time records.**
  [Detail](backlog/workforce.md#inspector-access-to-working-time-records).

- **Have the labour advisor check working-time exports before go-live.**
  [Detail](backlog/workforce.md#advisor-review-of-the-working-time-export).

- **Payroll export waits for the gestoría's import format.**
  [Detail](backlog/workforce.md#payroll-export-and-unused-scheduling-tables).

- **Frozen-summary name collection needs a valid test case.** Check whether a supported closed
  snapshot can name someone only in its summary before testing the defensive name-collection path.
  [Detail](backlog/workforce.md#frozen-summary-name-collection).

- **Choose readable PDF flags for working-time exports.**
  [Detail](backlog/workforce.md#pdf-boolean-and-empty-values).

- **The Spanish working-time record prints English words and internal codes** (seen by A980
  S2b): its version, access holders, events and author types, in the PDF and CSV.
  [Detail](backlog/workforce.md#the-spanish-working-time-record-prints-english-words-and-internal-codes).

- **Nothing in the product closes a pay period** (found by A793's design, read). A793's slice 6
  (tips frozen with the pay period) waits for one. Decide with the owner who closes a period and when.
  [Detail](backlog/workforce.md#nothing-in-the-product-closes-a-pay-period).

- **Pay-period cadence changes need a rule after closure.** A future editor refuses changes after
  the first closed period until the owner approves a transition rule (owner, 2026-10-15); leave it
  in the backlog until then.
  [Receipt and next step](backlog/workforce.md#pay-period-changes-after-closure).

- **Manager Hours needs a live-removal draft check.** Deleting the guard that keeps the
  selected person while a proposal is open leaves both Hours suites green. Add a controlled
  summary-removal case that checks the retained subject and blocked draft.

- **Workforce period reads still load complete history.** Narrow them without losing late or
  cross-period corrections; retain the new latest-instant and person-scoped reads. The remaining query paths are in
  [workforce detail](backlog/workforce.md#a10-period-read-cost).

- **Staffing paint in calendar delete confirmations.** Decide whether a shared deletion-impact
  seam should count staffing paint when you delete a season or special-day date. The approved
  A585 scope leaves that count out. [Detail](backlog/workforce.md#staffing-paint-in-calendar-delete-confirmations)

- **Loose ends left by A585-7 (#1766).**
  [Detail](backlog/workforce.md#loose-ends-left-by-a585-7-1766).

- **Rota warnings: pin the outer query's local-date boundaries.** The offset-aware in-week filter
  is covered, but replacing the unattached-shift query's local date with UTC leaves the warnings
  cases green. Add cases at the outer edges of its three-week window; see
  [workforce detail](backlog/workforce.md#rota-warning-query-boundaries).

- **Roster browser-entry guard: reject server-only re-exports.** It rejects a Node import but
  accepts `export … from "node:fs"`. Cover re-exports as well as imports; see
  [workforce detail](backlog/workforce.md#roster-browser-entry-re-exports).

- **A699. The Staffing month keeps its own copy of month stepping, and staffing its own date
  formatting.**
  [Detail](backlog/workforce.md#a699-the-staffing-month-keeps-its-own-copy-of-month-stepping-and-staffing-its-own-date-formatting)

- **A700. A failed Opening hours read also hides the Calendar's other views.**
  [Detail](backlog/workforce.md#a700-a-failed-opening-hours-read-also-hides-the-calendars-other-views).

- **A701. Opening hours' month reads the holiday tables twice on a holiday-linked special day.**
  [Detail](backlog/workforce.md#a701-opening-hours-month-reads-the-holiday-tables-twice-on-a-holiday-linked-special-day).

- **A702. Opening hours' season chip is clipped on a season name that is one long word.**
  [Detail](backlog/workforce.md#a702-opening-hours-season-chip-is-clipped-on-a-season-name-that-is-one-long-word).

- **At 390 px the staff role dialog's open colour panel covers its own Colour field.** Left open
  by A783.
  [Detail](backlog/workforce.md#at-390-px-the-staff-role-dialogs-open-colour-panel-covers-its-own-colour-field).

- **A colour chooser left open while its window narrows may hide the chosen colour.** Read by
  A783, not measured. Try it, and if it shows, keep the focused tile in view after the columns change.
  [Detail](backlog/workforce.md#a-colour-chooser-left-open-while-its-window-narrows-may-hide-the-chosen-colour).

- **A644. Staffing slots stop at minute 1440 on a business day longer than a day.** Decide whether
  a block may run to the day's real end.
  [Detail](backlog/workforce.md#a644-staffing-slots-stop-at-minute-1440-on-a-business-day-longer-than-a-day).

- **The Rota shift routes read a null or malformed JSON body as an empty object.**
  [Detail](backlog/workforce.md#the-rota-shift-routes-read-a-null-or-malformed-json-body-as-an-empty-object)

- **A707. On a phone, a paint grid's block menu or Copy to… chooser can cover the block it belongs to.**
  [Detail](backlog/workforce.md#a707-on-a-phone-a-paint-grids-block-menu-or-copy-to-chooser-can-cover-the-block-it-belongs-to).

- **A708. The special-day staffing painter draws every date on the location's baseline changeover,
  while each date's opening hours and staffing slots use that date's own.** Needs a decision on
  how one grid shows dates with different changeovers.
  [Detail](backlog/workforce.md#a708-special-day-staffing-on-a-date-with-its-own-changeover).

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

- **A586. Each person's contract terms, from ready-made rule sets that warn and never refuse
  (owner, 2026-10-22).** Waitron does not follow or enforce each country's or region's law.
  After A585.
  [Detail](backlog/workforce.md#a586-each-persons-contract-terms).

- **A587. Availability and personal preferences** (owner, 2026-10-22). After A586.
  [Detail](backlog/workforce.md#a587-availability-and-personal-preferences)

- **A588. A solver drafts the rota, as a paid Waitron Cloud feature (owner, 2026-10-22)**. After A587.
  [Detail](backlog/workforce.md#a588-a-solver-drafts-the-rota-as-a-paid-waitron-cloud-feature-owner-2026-10-22).

### Purchasing, recipes, stock and reports

- **The recipe routes and the recipe screen are unreached.**
  [Detail](backlog/back-office.md#the-recipe-routes-and-the-recipe-screen-are-unreached)

- **A supplier credit note cannot be entered through the dashboard** — OPEN, unqueued.
  [Detail](backlog/back-office.md#a-supplier-credit-note-cannot-be-entered-through-the-dashboard)

- **Loose ends left by service Task 12 (#923, adjustment reports).** A weighed item cancelled in
  part can differ by a cent between the cancel's list value and what stays on the line, so a rate
  can be a cent's share off.
  [Detail](backlog/back-office.md#loose-ends-left-by-service-task-12-923-adjustment-reports)

- **Comments and test titles left open by #615** — read, not run.
  [Detail](backlog/back-office.md#comments-and-test-titles-left-open-by-615)

### The box: backups, upgrades and recovery

- **A1089: authenticated server-certificate recovery is missing from the public connection page.**
  [Detail](backlog/box.md#authenticated-server-certificate-recovery)

- **A1089: diagnose and correct conflicting backup keys in the app.**
  [Correction](backlog/self-service-refusals.md#backup-key)

- **A1089: boot recovery must offer choices instead of an installer referral.** Recheck each
  cause and offer applicable restart, space, backup or reinstall choices, any needed authentication
  there and a safe Stop before destructive work. The original audit did not exercise these routes.
  [Correction](backlog/self-service-refusals.md#boot-recovery).

- **A1089: a repeated restored-box first-start failure needs a specific remedy.** Keep the existing restart attempt and identify a persistent completion refusal before suggesting another action.
  [Audit](backlog/self-service-refusals.md#restore-start).

- **A1089: backup preparation still needs missing-file and unknown-cause recovery.** Establish a supported remedy for `recovery.state_incomplete` and the `backup_stop` fallback; retain the safe cause and never manufacture replacement keys.
  [Audit](backlog/self-service-refusals.md#backup-preparation).

- **A1089: exhausted cleanup still needs a supported disk-recovery workflow.** Box status explains the backup-retention choice, its lack of immediate space recovery and leaving without changes. Provide an authenticated recovery choice when no reclaimable files remain and a new backup cannot fit; preserve database files, keys and saved backups.
  [Audit](backlog/self-service-refusals.md#backup-preparation).

- **A1089: a failed sealed-state refresh needs its cause and a retry route.** Expose a safe cause, offer a correction and any required sign-in there, and recheck that sealing succeeds. Do not promise current recovery keys before success.
  [Audit](backlog/self-service-refusals.md#backup-state).

- **A1089: bucket-copy host-configuration failures need guided diagnosis.** The settings refusal explains Change bucket, Test, Save and turn on, and Cancel. A configuration failure outside those fields still needs authenticated diagnosis and an applicable correction; preserve recovery keys and existing copies.
  [Remaining workflow](backlog/self-service-refusals.md#backup-stream).

- **A1089: a stopped or refused bucket stream needs restart or ownership choices.** Distinguish an unavailable process from a conflicting writer; do not suggest resuming an unauthorised primary. Offer any required sign-in there and build a missing restart/ownership workflow separately.
  [Audit](backlog/self-service-refusals.md#backup-stream).

- **A1089: persistent archive-settings failures need guided diagnosis.** Backups exposes the load error and lets you replace unreadable settings or leave without applying. A repeated host/key failure still needs authenticated diagnosis and an applicable correction, with a safe Stop.
  [Audit](backlog/self-service-refusals.md#backup-settings).

- **Backup destination failures log no elapsed time or operation phase.**
  Add non-sensitive phase and elapsed-time diagnostics when investigating real
  destination timeouts.
  [Detail](backlog/box.md#backup-destination-failures-log-no-elapsed-time-or-operation-phase)

- **Public TLS repair refuses linked layouts.** Healthy linked `tls/` folders still serve HTTPS,
  but a damaged linked folder or managed file cannot be repaired through the public guide. The
  public page offers retry, Check again and Stop; repairing a damaged linked layout remains open.
  [Detail](backlog/box.md#public-tls-repair-refuses-linked-layouts)

- **Cloud backup qualification and target-bound recovery: integrate the released Waitron verifier.**
  [Detail](backlog/box.md#cloud-backup-qualification-and-target-bound-recovery-integrate-the-released-waitron-verifier)

- **A917 — the owner chooses the server's `.local` name instead of `waitron.local`** — DESIGNED; not scheduled; not built.
  [Detail](backlog/box.md#a917--the-owner-chooses-the-servers-local-name-instead-of-waitronlocal)

- **On a full disk, a box whose kept certificates cannot be used shows the connection set-up page,
  with no word of the full disk.**
  Open: should that page also say the disk is full and show the free space?
  [Detail](backlog/box.md#on-a-full-disk-a-box-whose-kept-certificates-cannot-be-used-shows-the-connection-set-up-page-with-no-word-of-the-full-disk)

- **A route whose failure is the system's `ENOSPC` still answers `server.internal`.** `diskFullIn`
  (`@waitron/shared`) knows a full disk by code 13 or `storage.disk_full`, never `ENOSPC`; A798-B slice 2 names `ENOSPC`
  a full disk at start only (`fullDiskFailure`, `apps/server/src/boot-failure.ts`), because adding
  it to `diskFullIn` changes every route's answer.

- **The recovery page served at once on a full disk does not notice freed space by itself.** It
  shows the free space as it is on every load, but only Retry, which restarts the app, tries the
  start again (A798-B slice 2).

- **Migrating a box drops the change-feed triggers one statement at a time, outside a
  transaction.**
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
  [Detail](backlog/box.md#loose-ends-left-by-the-amazon-s3-rehearsals-cleanup-and-send-check-a641-1704)

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

- **A recovery kit can carry a recovery key its own restore refuses.**
  [Detail](backlog/box.md#a-recovery-kit-can-carry-a-recovery-key-its-own-restore-refuses)

- **A restore that fails while writing the secrets has already replaced the venue database.**
  [Detail](backlog/box.md#a-restore-that-fails-while-writing-the-secrets-has-already-replaced-the-venue-database)

- **A backup destination that fails to build leaves archives reported as on.**
  [Detail](backlog/box.md#a-backup-destination-that-fails-to-build-leaves-archives-reported-as-on)

- **The bucket copy's settings screen cannot repair a stored record that cannot be decrypted.**
  [Detail](backlog/box.md#the-bucket-copys-settings-screen-cannot-repair-a-stored-record-that-cannot-be-decrypted)

- **Nothing checks that the error codes in the dashboard's `backup_stop` word list are still real.**
  [Detail](backlog/box.md#nothing-checks-that-the-error-codes-in-the-dashboards-backup_stop-word-list-are-still-real)

- **No test covers the supervisor ignoring results from a backup run a reload replaced.**
  [Detail](backlog/box.md#no-test-covers-the-supervisor-ignoring-results-from-a-backup-run-a-reload-replaced)

- **Every backup status read builds a new client per destination**, a new S3 client for a bucket,
  and closes it once its listing settles, even while the running sweep holds live ones. This predates A538-3, which added
  `close()`; reusing the sweep's backends needs `close()` to wait for a status read in flight.

- **Whole-state-volume capture** (its own §5-reviewed slice): capture the whole state directory EXCEPT
  an explicit exclusion set, with a completeness guard that fails when a new top-level entry is
  neither captured nor excluded — the curated list went stale on `modules.json` already.
  [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **Backup & restore — carry-forwards (B2)**
  [Detail](backlog/box.md#backup--restore--carry-forwards-b2)

- **When a nightly report job exists, the backup slot should fire after it** — left open by the "backups off or stale" reminder (#371).

- **Guide replacement address settings after a cold restore.** Replace manual configuration of
  the advertised origin and dashboard origin/passkey domain with a recovery step that checks they
  match the replacement's address.
  [Detail](backlog/box.md#guide-replacement-address-settings-after-a-cold-restore)

- **Reconsider the backup container against off-the-shelf tools** (a brainstorm): `WBA1` plus
  `WBK1` is restorable only by Waitron code. Scheduled local archives stream through protected
  files; reconsider using a standard encryption and archive format.

- **B3. The bootable USB installer** — design approved with changes; [six-slice plan](superpowers/plans/2026-10-26-b3-usb-installer.md), no build.
  No setup codes: the owner closed W60's first-claim concern as not a concern; production-mode restrictions stay.
  Every sheet repeats the disk key; local/network Waitron unlock has one policy choice open.
  Build/API and hardware gates remain. [Detail](backlog/box.md#b3-the-bootable-usb-installer)

- **The box image carries the WireGuard link.** [Detail](backlog/box.md#box-image-constraints-b3)

- **Kiosk options, none built:** Chromium in the box image, every box (the owner's decision in B3's
  answers, 2026-10-21), and, later, Fully Kiosk resale for dedicated tablets.
  [Detail](backlog/box.md#box-image-constraints-b3)

- **The box the customer buys probably doubles as a till, so the image ships a screen and a browser** — owner, 2026-09-29; decided in B3's answers (2026-10-21): every box carries Chromium under `cage`, no desktop; its screen opens the dashboard after setup and can become a till like any other device ([B3 design §9](superpowers/specs/2026-10-21-b3-usb-installer-design.md)). [Detail](backlog/box.md#the-box-the-customer-buys-probably-doubles-as-a-till-so-the-image-ships-a-screen-and-a-browser)

- **a local maintenance account on each box** — belongs with B3; a discussion record, not an approved spec. Its remote-support half is tracked in Cloud and not approved. [Detail](backlog/box.md#a-local-maintenance-account-on-each-box)

- **A799. Real historical upgrade testing: build authorised; blocking before go-live.**
  The owner authorised all seven [implementation-plan](superpowers/plans/2026-10-22-a799-real-upgrade-testing.md) cuts on 23 October 2026. Cuts 1–3 add metadata admission, oldest-supported plus previous-retained selection, pending-migration classification, pure typed record/schema comparison and bounded archive/fetch admission with injected adapters; the qualification index is empty. Actual filesystem adapters, isolated rigs, historical qualification, continued-sale execution and trusted CI wiring remain open.
  Runtime, capture, A760 reset, migration, upload, provider and CI activation gates remain. No historical image, issued-F1 preservation or real upgrade is qualified. [Detail and current execution contract](backlog/box.md#2026-10-23-a799-build-authority-and-history-selection).
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

- **Automatic upgrades that can be undone until the first order** — owner, 2026-10-02. It takes no backup first, and once the new image has migrated the database there is no way back — an older image then refuses to start with `provisioning.database_ahead` (`deploy/README.md`, "It can migrate the box's database one way"). The point of no return is the first order taken on the new version, not the restart: rolling back after that would lose the order. [Detail](backlog/box.md#automatic-upgrades-that-can-be-undone-until-the-first-order)

- **Every migrating path but boot and the bucket rebuild runs with no ahead-of-image check.** [Detail](backlog/box.md#every-migrating-path-but-boot-and-the-bucket-rebuild-runs-with-no-ahead-of-image-check)

- **What `waitron.sh install`'s self-refresh (C83, #890) left open:** No case in `scripts/waitron-sh.test.mjs` covers a script not run from a file, a link `readlink -f` cannot follow, a folder the script cannot enter, or a box with neither curl nor wget. [Detail](backlog/box.md#what-waitronsh-installs-self-refresh-c83-890-left-open)

- **What `waitron.sh --reset install` (#1122) left open:** a build or pull that fails still leaves the box's files changed, as a plain `install` always has. [Detail](backlog/box.md#what-waitronsh---reset-install-1122-left-open)

- **What showing the failed start's reason (#695) left:** [Detail](backlog/box.md#what-showing-the-failed-starts-reason-695-left)

- **A798-B. Build "degraded but trading": what the box does, and tells staff, when a part fails but
  it can still sell.**
  Design revision 7 (2026-10-24).
  [Detail](backlog/box.md#a798-b-build-degraded-but-trading-what-the-box-does-and-tells-staff-when-a-part-fails-but-it-can-still-sell)

- **AEAT's time for a confirmation comes from its QR validation host, not from a `consultar` reply.**
  [Detail](backlog/box.md#aeats-time-for-a-confirmation-comes-from-its-qr-validation-host-not-from-a-consultar-reply)

- **A clock set back before the mail server's certificate start may not be able to send the
  clock-stop email.** An inference from slice 10's plan P8, not measured. Left open by A798-B
  slice 9 (#2025).

- **A device's or an administrator's time is self-reported.**
  [Detail](backlog/box.md#a-devices-or-an-administrators-time-is-self-reported)

- **A second confirmation naming the same record while the first's alerts are open records no
  second alert.** The bell keys an open alert by the named record's sale, so the second folds into
  the first; `clock_confirmations` and the Box status page keep both. Left open by A798-B slice 9
  (#2025).

- **`clock.unusable` in the bell is judged at offset 0**, so in the first hour of 28 October 2024,
  mainland Spanish time, the bell can say the clock is before that day where the till does not.
  Left open by A798-B slice 9 (#2025).

- **The box sends AEAT's QR host a HEAD once a minute by its steady clock (on every look when that clock cannot be read or went backwards) while the Veri\*Factu module reports the box's clock behind the latest sale — during a stop, and under a confirmation that lifted it — or while a clock check whose stop has ended waits for its witness**
  [Detail](backlog/box.md#the-box-sends-aeats-qr-host-a-head-once-a-minute-by-its-steady-clock-on-every-look-when-that-clock-cannot-be-read-or-went-backwards-while-the-verifactu-module-reports-the-boxs-clock-behind-the-latest-sale--during-a-stop-and-under-a-confirmation-that-lifted-it--or-while-a-clock-check-whose-stop-has-ended-waits-for-its-witness)

- **The clock watch's suspend-aware clock has not been run on Linux.** It reads `/proc/uptime` so
  that a box waking from sleep is not taken for a clock jumping forward; the tests replace the file,
  and nobody has watched it across a real suspend or a setting of the wall clock on a Linux box
  (`docs/developers/conventions-data.md`, "A jump"). Left open by A798-B slice 9 (#2025).

- **AEAT's time outranks the devices.**
  [Detail](backlog/box.md#aeats-time-outranks-the-devices)

- **A confirmation under which no sale was recorded raises no 'disproved' alert** when its clock
  later proves wrong; the box logs it. Left open by A798-B slice 9 (#2025).

- **After a 'disproved' alert, the confirmation still covers and later sales are not added to the
  alert.** Its `{to}` is the latest sale when the disproof was seen; sales made afterwards on the
  same clock appear in no alert. Whether a disproof should stop payments again is for the owner
  (slice 9 decision 14). Left open by A798-B slice 9 (#2025).

- **A malformed confirmation covers nothing.** A row of the append-only `clock_confirmations`
  whose chain heads are unreadable, not whole numbers of zero or more, or past the chain's current
  ones lifts no stop; a fresh confirmation of the same record can lift it (slice 9 decision 21).
  Left open by A798-B slice 9 (#2025).

- **A remote administrator reaching the box through the cloud tunnel cannot confirm its clock.**
  The tunnel delivers requests from the box's own loopback address, so the box takes them for its
  own screen and refuses them (`same_machine`). It fails closed; how to tell the two apart is open
  (owner FYI 13). Left open by A798-B slice 9 (#2025).

- **`clock_stop_restarts` is written by nothing: drop it, and its two backup-check links, in the
  go-live migration squash (A760).**
  [Detail](backlog/box.md#clock_stop_restarts-is-written-by-nothing-drop-it-and-its-two-backup-check-links-in-the-go-live-migration-squash-a760)

- **A future cloud or proxied primary sees every request as the box's own**, so no device would
  count as a clock witness and no administrator could confirm its clock. Today a venue has one node
  and no cloud primary; one that exists needs its own rule (design §4.9 h, point 3). Left open by
  A798-B slice 9 (#2025).

- **Correct the sales dated wrongly once the tax adviser answers Q60.** What the correction is
  waits on [Q60](compliance/asesor-questions.md#q60-sales-dated-later-than-the-real-time-by-a-clock-that-ran-ahead-added-2026-10-24);
  A1088 built only the list, the handled lists, the note and the download. Left open by A1088.

- **Some sales dated wrongly are in no list**: those of a clock put right from little more than a
  minute ahead, and those of a stop the box "cannot tell" about, which has no list and no download.
  Left open by A1088 (design §4.9 f).
  [Detail](backlog/box.md#some-sales-dated-wrongly-are-in-no-list)

- **The real time of a sale dated wrongly is unknown**: the adviser's file says "Unknown" on every
  row and gives a time each sale was made before instead (A1088 decision 8). Slice 9c's clock
  checks are the first place a real time could be worked out. Left open by A1088.

- **The adviser's file writes invoice dates that follow the server's own time zone until A696 is
  built**: the file writes the stored issue date, which follows the process zone today (A1088
  decision 7). Left open by A1088. [A696](backlog/fiscal.md#walk-up-invoice-dates-follow-the-server-process-time-zone)

- **The bell's and the Alerts screen's Mark handled take no note**, and the Alerts screen's Handled
  tab shows no notes; only the Box status page writes and shows them (A1088 decision 4). Left open
  by A1088.

- **Box status's "cannot tell" sentence, and the note dialog's summary of it, write the stop's start
  in the browser's time zone**, while the section's tables and the adviser's file write each sale's
  time at its stored offset: the sentence is the shared `alertMessage` wording. Left open by A1088.

- **An open list of wrongly dated sales whose list read failed shows no Download** until a later
  read of the lists answers. A list the box restarted during still shows its sentence and Mark
  handled; a plain one shows neither. Left open by A1088.

- **The Box status page's Handled lists fold reads every handled list when opened, with no
  limit** (A1088 decision 1); page it if a venue gathers many. Left open by A1088.

- **The adviser's file is comma-separated in both languages, and a spreadsheet set to expect
  semicolons may open the Spanish file in one column.** Excel in Spain is untested; whether `es`
  should use `;` is the owner's decision. Left open by A1088.
  [Detail](backlog/box.md#the-advisers-file-is-comma-separated-in-both-languages)

- **The bell's printer check reads every print job.**
  [Detail](backlog/box.md#the-bells-printer-check-reads-every-print-job)

- **A card reader whose status the provider could not read raises nothing.** SumUp and Stripe
  answer `{ online: false, unreachable: true }` rather than throwing, so
  `reader.status_unavailable` comes only from a throw or the 45 s deadline (slice 10 plan P2). Left
  open by A798-B slice 10.

- **Does a SumUp Solo that is on but idle report itself offline?** The owner's unused Solo read
  `OFFLINE` (slice 10 plan P11), and SumUp's client maps anything but `ONLINE` to offline, so if an
  idle Solo does the same, the bell carries a standing `reader.offline` warning. For the owner to
  check against the reader. Left open by A798-B slice 10.

- **The email about a clock set before 28 October 2024 rarely leaves the box.**
  [Detail](backlog/box.md#the-email-about-a-clock-set-before-28-october-2024-rarely-leaves-the-box)

- **`waitron.sh` deletes only the images the box ran just before an upgrade.** Images left by
  upgrades before slice 10 and the mail capture's old images are not deleted, nor is Docker's build
  cache from branch installs, which holds most of a rebuilt image's space. Left open by A798-B
  slice 10.

- **A printer that prints some documents and fails others loses its till notice.** The notice goes
  once any later document on the printer prints (slice 10 decision 18), while the bell keeps
  naming the printer until the failed ticket is reprinted or resent. Left open by A798-B slice 10.

- **`sale.charged_not_recorded` for the clock answers HTTP 507.** The till reads the code and
  reason; a status by reason needs the error boundary to take a function. Left open by A798-B
  slice 8 (#2012).

- **A Pay of an order whose invoice was already filed says 'Sale not recorded' during the clock
  stop**, where the payment is what is not recorded. Left open by A798-B slice 8 (#2012).

- **The till's card-charged sentence for the clock says "press Pay", which does not fit a bill's
  card.**
  [Detail](backlog/box.md#the-tills-card-charged-sentence-for-the-clock-says-press-pay-which-does-not-fit-a-bills-card)

- **A collect refused with both times shows the payment sentence** ("Sale not recorded…",
  `clockBehindText` in `apps/till/src/widgets/find-bill-dialog.ts`), not the "Can't be recorded"
  sentence the plan's decision 20 lists for a collect. Left open by A798-B slice 8 (#2012).

- **A clock that jumps before 28-10-2024 while a card is charged answers `clock.unusable`, and the
  till never says the card was charged.** Only a full disk and `clock.behind_chain` become
  `sale.charged_not_recorded` (`apps/server/src/bill-payments.ts`, `apps/server/src/till-sale.ts`;
  read, not run). Left open by A798-B slice 8 (#2012).

- **The design's "printing a bill carries on" is wider than the product.** No route prints a bill
  for checking; the prints are a filed sale's receipt and reprint and the kitchen reprint, so during
  the stop a bill not filed before it cannot be printed. Left open by A798-B slice 8 (#2012).

- **The Clock row says 'connect the box to the internet' where that may not help.**
  [Detail](backlog/box.md#the-clock-row-says-connect-the-box-to-the-internet-where-that-may-not-help)

- **The clock stop's look differs from pictures 8 and 9.** The counter refusal shows in the till's
  top banner, not under the strip; the Clock row's fix advice follows " · " on the comparison line
  rather than on a line of its own; the Box status page shows the alert sentence "Sort it out on the
  Box status page" while on that page. Left open by A798-B slice 8 (#2012).

- **'Equipo' names two things in the Spanish dashboard.**
  [Detail](backlog/box.md#equipo-names-two-things-in-the-spanish-dashboard)

- **The Tax agency row does not say since when sends have failed.** Picture 4 draws «los envíos
  fallan desde 17:31»; the row shows the last acceptance. The technical incident's open time could
  carry it. Left open by A798-B slice 7b (#2030).

- **No row records who pressed Retry now.** The press is a log line (`fiscal.retry_now`), not an
  audit row. Left open by A798-B slice 7b (#2030).

- **Liberar cannot be pressed on a mirror or a fenced node.** The read-only gate refuses every
  POST there, so the page draws it quiet and says why; a mirror's disk can fill too. Left open by
  A798-B slice 7.

- **On a box with card payments off, the card-reader battery check may raise
  `alert.source_unavailable` on every bell read.**
  [Detail](backlog/box.md#on-a-box-with-card-payments-off-the-card-reader-battery-check-may-raise-alertsource_unavailable-on-every-bell-read)

- **Every start deletes a backup folder configured inside backup staging under a `backup-encrypt-`
  name.** Free skips one since slice 7's finish review; the start's clean-up reads no backup
  settings. Left open by A798-B slice 7.
  [Detail](backlog/box.md#every-starts-clean-up-deletes-a-backup-folder-configured-inside-backup-staging-under-a-backup-encrypt--name)

- **The disk line's remainder is 'the rest of the disk', not 'outside Waitron'.** It includes the
  state folder's other files; measuring them separately would let the page name what is not
  Waitron's. Left open by A798-B slice 7.

- **The start's clean-up can reach a linked log folder's target given a trailing separator.**
  `start-space.ts` builds the log folder's paths without the `resolve()` that `free-space-now.ts`
  gained, so a log folder configured as a link with a trailing separator defeats its link check;
  read, not run. Left open by A798-B slice 7.

- **An open clock-drift alert's seconds can differ from the Clock row's.** The bell reads less
  often than the page. Left open by A798-B slice 7.

- **The dashboard shell's other first reads were not checked on a full disk.** Slice 7 made the
  Box status read and the bell's alert reads answer there; the shell's other reads at sign-in were
  not tried. Left open by A798-B slice 7.

- **An alert source that writes would take the whole bell read down on a full disk.**
  [Detail](backlog/box.md#an-alert-source-that-writes-would-take-the-whole-bell-read-down-on-a-full-disk)

- **The recovery page says the start "deleted what it could make again"; the Box status page says
  "files the box no longer needs".** One wording for the same set. Left open by A798-B slice 7.

- **Till write surfaces other than the draft save, the unpaid departure and the station screen were
  not checked for a full-disk refusal's words**
  [Detail](backlog/box.md#till-write-surfaces-not-checked-for-a-full-disk-refusals-words)

- **On a full disk, a till read whose route opens a `withTransaction` is refused while a change
  waits.**
  [Detail](backlog/box.md#on-a-full-disk-a-till-read-whose-route-opens-a-withtransaction-is-refused-while-a-change-waits)

- **A failed staff-notice check is seen in the log and as a note on the Box status page; the bell
  does not show it.** A bell alert would tell the manager when the unsent count cannot be worked
  out. Left open by A798-B slice 6 (#1977).

- **The strip draws no tinted background and no coloured words, unlike picture 2.** No token is
  named for the tints and `color-mix()` is refused; tint tokens with their contrast checks would let
  it. Left open by A798-B slice 6 (#1977).

- **No strip on the clock-in and attendance pages.** `till-app` draws them instead of the shell.
  Left open by A798-B slice 6 (#1977).

- **A till nobody has signed in to shows no strip on a full disk, and PIN sign-in is refused
  then.** The sign-in page shows only the refusal's own sentence. Left open by A798-B slice 6
  (#1977).

- **A kitchen screen on a full disk can be reported dark while it works.** Since slice 6 its
  requests are served on a full disk but its last-seen time is not saved, so the dark-screen check
  (`SCREEN_DARK_MS`, `apps/server/src/station-outputs-down.ts`) raises it after three minutes,
  beside the full disk's own alert. Left open by A798-B slice 6 (#1977).

- **The refund guide does not say that recording a separate-terminal refund is refused during a
  full-disk stop.** One sentence in each language, as the kitchen-service guide already has.
  [Detail](backlog/box.md#the-refund-guide-does-not-say-that-recording-a-separate-terminal-refund-is-refused-during-a-full-disk-stop)

- **A transaction opened outside the write queue can let a body's writes after a full disk
  commit.**
  [Detail](backlog/box.md#a-transaction-opened-outside-the-write-queue-can-let-a-bodys-writes-after-a-full-disk-commit)

- **Transactions opened outside the write queue at the same time get a wrong error message.**
  Next step: decide whether the store should refuse a second outside transaction outright, or only
  word the error for this case (`packages/store/src/node-sqlite-adapter.ts`).
  [Detail](backlog/box.md#transactions-opened-outside-the-write-queue-at-the-same-time-get-a-wrong-error-message)

- **A test comment still names the old savepoint error.**
  `packages/fiscal-verifactu/src/correction-path.e2e.test.ts:308` says its control "fails with
  `no such savepoint`"; since #1936 that text is only the error's cause, not its message. Reword
  the comment (a comment in a fiscal test, not the fiscal core).

- **Recovery actions the 2026-09-08 node-containers design handed on** (§9.3, §12) — starting without
  a module that fails at start, undoing the last module change, and a migration that applied only in
  part. Not designed.
  [Detail](backlog/box.md#recovery-actions-the-2026-09-08-node-containers-design-handed-on)

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
  staging folder**
  [Detail](backlog/box.md#resolvesafeentrypath-appsserversrcstate-secretsts-is-unchanged-and-nothing-chmods-the-staging-folder)

- **`apps/server/src/errors.ts` still cites CLAUDE.md §5 for things §5 does not say** — found by
  #656 while pruning comments. No production caller sets `skipSecrets` any more, so whether the
  option should go is open.
  [Detail](backlog/box.md#appsserversrcerrorsts-still-cites-claudemd-5-for-things-5-does-not-say)

- **`apps/server/README.md` (near line 230, the `WAITRON_SKIP_RETRY_MS` row) says the sleep clamp
  can round a value "past" a bound, which it cannot** — found by #653 while pruning comments.
  [Detail](backlog/box.md#appsserverreadmemd-near-line-230-the-waitron_skip_retry_ms-row-says-the-sleep-clamp-can-round-a-value-past-a-bound-which-it-cannot)

- **The empty-venue-directory reason #561 deleted from `packages/provisioning` … is false there**
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

- **A too-short recovery key's refusals do not link to the button they name**
  [Detail](backlog/box.md#a-too-short-recovery-key-the-refusals-do-not-link-to-the-button-they-name-and-change-the-recovery-key-cannot-finish)

- **A relative backup folder is accepted.** The Backups screen's hint asks for a full path, but
  the server resolves whatever it is given (`resolveArchiveChoice`, `apps/server/src/archive-settings.ts`),
  so `backups-relative` saved as a folder under the server's working directory (seen on the dev
  stack during A538-6's visual check). That line came in with #1628 (A538-4).

- **The Backups screen's bucket fields copy the bucket copy panel's.**
  Share them. Left open by A538-6.
  [Detail](backlog/box.md#the-backups-screens-bucket-fields-copy-the-bucket-copy-panels)

- **At phone width the configuration export's passphrase labels overlap "Show password"** on the
  Backups screen (seen at 390 px during A538-6's visual check, both themes). I believe this predates
  A538-6: the export section came in with #296.

- **Loose ends left by SQLite slice 2 Task 2a (#557, a recovery key that does not need an archive
  destination).**
  [Detail](backlog/box.md#loose-ends-left-by-sqlite-slice-2-task-2a-557-a-recovery-key-that-does-not-need-an-archive-destination)

- **Loose ends left by SQLite slice 2 Task 3a (#566, one process per venue folder; #573; #608).**
  [Detail](backlog/box.md#loose-ends-left-by-sqlite-slice-2-task-3a-566-one-process-per-venue-folder-573-608)

- **Loose ends left by SQLite slice 2 Task 5 (#569, `@waitron/stream`).**
  Every synchronous `deriveKey` caller still blocks the event loop while it derives.
  [Detail](backlog/box.md#loose-ends-left-by-sqlite-slice-2-task-5-569-waitronstream)

- **Loose ends left by SQLite slice 2 Task 6 (#590, the Litestream supervisor).**
  `pnpm setup:litestream` skips the download when the installed binary already reports the
  pinned version, so the checksum protects fresh downloads only.
  [Detail](backlog/box.md#loose-ends-left-by-sqlite-slice-2-task-6-590-the-litestream-supervisor)

- **Loose ends left by SQLite slice 2 Task 7 (#619, how current the bucket copy is).**
  Whether Litestream uploads anything while the side file is unchanged is not measured.
  [Detail](backlog/box.md#loose-ends-left-by-sqlite-slice-2-task-7-619-how-current-the-bucket-copy-is)

- **Loose ends left by A549.**
  Whether the side file grows, and the pause fires, in a real network outage was not run.
  [Detail](backlog/box.md#loose-ends-left-by-a549)

- **Task 8a** (#627, the server side of the bucket-copy settings): the dead-process pointer write
  under Task 6 applies here too. Left open by SQLite slice 2.

- **When the key rename and the put-back both fail, the new certificate is left beside the old key**
  [Detail](backlog/box.md#when-the-key-rename-and-the-put-back-both-fail-the-new-certificate-is-left-beside-the-old-key)

- **Loose ends left by SQLite slice 2 Task 9b (#642, `waitron-restore restore --from-bucket`).**
  `pragma integrity_check` is one blocking statement, and the venue watchdog kills a process
  after 120 seconds without a timer turn.
  [Detail](backlog/box.md#loose-ends-left-by-sqlite-slice-2-task-9b-642-waitron-restore-restore---from-bucket)

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
  [Detail](backlog/box.md#loose-ends-left-by-668-686-a57-a60-and-723-the-pause-test-and-the-buckets-error-reports)

- **A venue preparing to go live sends real email through SMTP (A987) — BUILD.**
  [Detail](backlog/box.md#a-venue-preparing-to-go-live-sends-real-email-through-smtp-owner-2026-10-03--open)

- **Support an office SMTP server's own certificate authority — OPEN.** A987 keeps certificate
  verification on and defers this case. Design how an admin supplies trust before adding support;
  provide no switch that disables verification.
  [Detail](backlog/box.md#support-an-office-smtp-servers-own-certificate-authority)


- **The setup wizard's email test connects wherever an unauthenticated caller points it (A987
  review, 2026-10-22) — OPEN.**
  [Detail](backlog/box.md#the-setup-wizards-email-test-connects-wherever-an-unauthenticated-caller-points-it-a987-review-2026-10-22--open)

- **A blank "Time of day" on the backup screen sends `{ hour: 0, minute: NaN }`** — left open by
  A178 (#1010 to #1019), seen while building, not changed: the same parsing is on `main` before
  A178b (`#buildSchedule`'s `split(":")`); what the server does with it was not checked.

- **A restore from a backup file derives the archive's key at least three times**, each an N=2^17
  scrypt: at least once at each of preview, staging and the next start. Deriving it once would save CPU on the box;
  it is a behaviour change on the restore path and needs its own tests. Left open by A938.
  [Detail](backlog/box.md#a-restore-from-a-backup-file-derives-the-archives-key-at-least-three-times)

- **The Box status page reads the wrongly-dated-sales alerts' params through a cast**, keeping its
  own copy of a shape the Veri\*Factu module writes; a fiscal seat method answering the typed list
  would remove it. Left open by A798-B slice 9 (#2025).
  [Detail](backlog/box.md#the-box-status-page-reads-the-wrongly-dated-sales-alerts-params-through-a-cast)

### Replication, failover and the cloud

_Formerly _Afterwards_ and _Cloud connection integration_._ Detail: [backlog/replication-cloud.md](backlog/replication-cloud.md).

Not in any track until the standalone primary is done.

- **A1018. Simple controlled and emergency handover, with Cloud only a placement.** M2 handles
  all AEAT communication after either takeover; returning M1 transfers fiscal originals/outcomes only.
  The owner approved both Harbour Kitchen handovers and retained defaults on 24 October 2026.
  Exact formats, compatible A947 amendments, separate build authority and physical runtime qualification remain open.
  [Detail](backlog/replication-cloud.md#a1018-agree-and-build-the-hosted-writer-stop-proof-contract)

- **The till's theme fetch does not follow a server move (A841 slice 3).** The till fetches
  `/api/theme` from the page's own address, not through `ServerRouter`; moved to another server, it
  would keep the theme it has, or take the old server's while that one still answers, so failover
  work must route it ([conventions-ui.md](developers/conventions-ui.md)).

- **A mirror keeps a renamed server's old chart (A917).** After a rename its copy would name the
  old address until it is paired again. No reader routing by a mirror's copy was found (not exhaustive).
  [Detail](backlog/replication-cloud.md#a-mirror-keeps-a-renamed-servers-old-chart-a917)

- **A completed provision or adopt operation replayed on a later request still answers 200 without
  restarting and keeps the setup lock set.**
  [Detail](backlog/replication-cloud.md#a-completed-provision-or-adopt-operation-replayed-on-a-later-request-still-answers-200-without-restarting-and-keeps-the-setup-lock-set)

- **`docs/developers/conventions-data.md`'s `busy_timeout` receipt … should carry the date and Node
  version the deleted comment had.**
  [Detail](backlog/replication-cloud.md#docsdevelopersconventions-datamds-busy_timeout-receipt--should-carry-the-date-and-node-version-the-deleted-comment-had)

- **The boot-time fetch is given only the URL … and boot never reads the `superseded` that
  `reconcileMembershipOnBoot` returns.**
  [Detail](backlog/replication-cloud.md#the-boot-time-fetch-is-given-only-the-url--and-boot-never-reads-the-superseded-that-reconcilemembershiponboot-returns)

- **The tunnel's stand-in relay pairs with sockets that have already gone.** When a parked box
  closes, it stays in `idle` until a client takes it, so the next client is paired with the dead
  box and its bytes go nowhere. Only fix this if `@waitron/tunnel` outlives its planned retirement.
  [Detail](backlog/replication-cloud.md#the-tunnels-stand-in-relay-pairs-with-sockets-that-have-already-gone)

**The on-prem mirror.** Read this section as requirements slices 3–5 must meet, not as work
outstanding on code that exists.

- **A1111. Personal sign-in on read-only mirrors.** Review the proposed account, session and
  fifteen-minute freshness limits; then plan and build personal permission checks in place of the
  ambient administrator. A usable release also needs qualified account-copy freshness.
  [Design](superpowers/specs/2026-10-26-a1111-mirror-personal-sign-in-design.md)

- **A947. Go-live on two local boxes.** The owner approved the revised design; slice 4a landed as
  [#1990](https://github.com/clintongormley/waitron/pull/1990) on 2026-10-24. Slices 3a onwards
  are still open; slice 3a's plan is next. [Detail](backlog/replication-cloud.md#a947-go-live-on-two-local-boxes)

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

- **The two-node end-to-end proof over LAN and over WireGuard**, including the same-site cookie
  browser receipt still owed from the till reroute, #257 (needs interactive Chrome + mkcert +
  `/etc/hosts`).

- **Richer daily close** — one close run by the primary across all tills.

- **Replication, membership & failover — residuals.** Until slice 3 a venue has ONE node and no
  failover at all. Read the residuals as requirements for what failover is rebuilt INTO, not as
  descriptions of code that exists today.
  [Detail](backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)

**Cloud integration and SQLite work.**

- **Loose ends left by the Cloud connection integration.** Customer remote setup UI and production
  deployment remain open. Continuous complete-server recovery, planned final-write handover and
  production recovery remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-cloud-connection-integration)

- **Four Cloud reply and state readers accept a one-item list where they want text.** Each turns
  the field into text before checking it, so `["ready"]` passes as `"ready"`.
  [Detail](backlog/replication-cloud.md#four-cloud-reply-and-state-readers-accept-a-one-item-list-where-they-want-text)

- **The signing and size-capped reading of a request to Cloud is repeated across the
  `apps/server/src/cloud-*.ts` files.** One shared helper would serve them all; left out of #1729
  as a refactor larger than that PR (its simplify review, 2026-10-15).

- **Observations are synthetic until service adapters exist.** Left open by the Cloud connection
  integration (2026-09-24; #638, #808).

- **A951. The box's lasting tunnel and public-certificate client.** Build approved; isolated helper profile accepted.
  Follow the [plan amendment](superpowers/plans/2026-10-22-a951-connection.md#focused-d130d132-amendment-2026-10-23), obtain [routing revision 2](superpowers/specs/2026-10-23-a951-routing-v1-revision2.md) acceptance and finish the appliance amendments.
  Live authority, upstream, privacy and runtime/provider gates remain open.
  [Detail](backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client)

- **Waitron retains:** the implemented Cloud connection screen and manager adapter; box-side
  networking and `@waitron/tunnel`'s retirement; first-contact trust bootstrap; and the cloud-standby
  end-to-end proof. Do not restart the cloud-standby work until the boundary contract is settled.
  [Detail](backlog/replication-cloud.md#waitron-retains)

- **SQLite + Litestream replaces PostgreSQL.** Next: slice 3, seats and promotion. Its first task
  is already decided: credentials move to a venue key stored in `venue.db` only in locked form.
  [Detail](backlog/replication-cloud.md#sqlite--litestream-replaces-postgresql)

- **Loose ends left by the SQLite failover-loop prototype gate.** Validate every supported object
  store. A promoted node's generation and Cloud's recovery orchestration remain; settle the
  Waitron ↔ Waitron Cloud contract before assigning them.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-the-sqlite-failover-loop-prototype-gate)

- **Task 1a** — Deny's delete is the one join-request node filter no test fails without. Holders
  torn by a concurrent promotion, credential sealing and scheduler takeover remain unverified.
  [Detail](backlog/replication-cloud.md#task-1a--node-filters-and-unverified-concurrency-claims)

- **Loose ends left by SQLite slice 2 Task 9a.** A node row holding no endorsement still signs
  `endorsements: []`, and no first-start case asserts it. Restore fencing, membership trust and
  signature checks, curated refusals and promotion with a pending first start remain open.
  [Detail](backlog/replication-cloud.md#loose-ends-left-by-sqlite-slice-2-task-9a)

- **If a later slice moves `local` tables into `node.db`**, that slice decides again how the drain
  crosses the two files: SQLite refuses a trigger body that writes another attached database.
  [Detail](backlog/replication-cloud.md#if-a-later-slice-moves-local-tables-into-nodedb)

- **A promoting standby may list itself with an empty `contactUrl`, so no till is told to dial it.**
  `nextStandings` appends it with an empty `contactUrl`, and `routableServers` then drops it.
  Found by reading, not run.
  [Detail](backlog/replication-cloud.md#a-promoting-standby-may-list-itself-with-an-empty-contacturl)

### CI, tests and developer tooling

For package distribution and the four-minute target, use the
[CI job layout](developers/ci-and-gates.md#ci-job-layout-and-scheduling).

- **Investigate the joined-table reset test's revision refusal.** The expected occupied-table
  refusal became `floor_today.out_of_date` on A1114's post-merge run; the cause is unknown.
  [Detail](backlog/ci.md#the-joined-table-reset-test-received-a-revision-refusal).

- **A1089 merge read-back: server coverage upload timed out.**
  [Detail](backlog/ci.md#a1089-merge-read-back-server-coverage-upload-timed-out).

- **The first fiscal-hour end-to-end file exceeds the four-minute job budget on slow CI runners.**
  Four successful main runs on 24 October measured the file alone at 248–250 seconds. Split or
  reduce its repeated setup while preserving its restart assertions.
  [Detail](backlog/ci.md#the-first-fiscal-hour-end-to-end-file-exceeds-the-job-budget).

- **A backlog detail link still names the old five-handler heading.** The till entry’s
  `backlog/till.md#five-till-handlers-still-leave-a-failed-list-refresh-unhandled-and-one-a11y-file-may-not-render-its-screen`
  no longer matches “Three till handlers still leave a failed list refresh unhandled”.
  Retarget the link during the till backlog cleanup; keep the open handlers entry.

For browser storage checks, inspect the operation's own entry and every write, comparing complete
values rather than PIN substrings inside random IDs. See the
[testing guide](developers/testing-guide.md#check-stored-secrets-as-values-and-inspect-every-write).

- **Tests that read a built command's error output fail under Claude Code.** The command's stderr
  begins with a `<claude-code-hint … />` line, so `apps/server/src/first-fiscal-launch.test.ts` and
  seven `packages/provisioning` CLI cases fail locally under an agent on `main` (A798-B slice 8
  plan, E8 and E13). Found while planning A798-B slice 8.

- **Switching the till's language mid-screen with `setLocale` left no error banner in some browser
  tests.** Not diagnosed: a test-harness effect, or a refusal a language change hides.
  [Detail](backlog/ci.md#switching-the-tills-language-mid-screen-with-setlocale-left-no-error-banner-in-some-browser-tests)

- **The UI showcase overflows a phone and inherits black text in its dark panel.**
  [Detail](backlog/ci.md#the-ui-showcase-overflows-a-phone-and-inherits-black-text-in-its-dark-panel).

- **Find why GitHub created no workflows for A987's main merge (A1022).** The runs API
  returned no runs for `e7ce92a7c`; the cause remains unverified. Recovery and the successful-CI
  baseline do not explain the missing trigger. Retain the after-merge run check.
  [Recovery procedure](developers/ci-and-gates.md#recover-a-main-commit-whose-ci-run-was-never-created).

- **Other `uses:` steps that fetch over the network have no step time limit, and the runner's own action download at job set-up is bounded only by long limits of its own (left open by A935).**
  Artifact uploads now have bounded retries (A1100); the remaining sites are setup-node, cache, Docker and CodeQL.
  [Detail](backlog/ci.md#other-uses-steps-that-fetch-over-the-network-have-no-step-time-limit-and-the-runners-own-action-download-at-job-set-up-is-bounded-only-by-long-limits-of-its-own-left-open-by-a935).

- **Whether the 2026-10-20 checkout stalls were a GitHub-side incident was not checked (A935)**
  [Detail](backlog/ci.md#whether-the-2026-10-20-checkout-stalls-were-a-github-side-incident-was-not-checked-a935).

- **Profile provisioning's busiest shard after the A679 split.**
  [Detail](backlog/ci.md#profile-provisionings-busiest-shard-after-the-a679-split).

- **Investigate two full-run till browser failures seen during A669 validation.**
  [Detail](backlog/ci.md#investigate-two-full-run-till-browser-failures-seen-during-a669-validation).

- **Decide whether browser tests stop replacing modules (A943 follow-up).**
  [Detail](backlog/ci.md#decide-whether-browser-tests-stop-replacing-modules-a943-follow-up).

- **Check the older capture suites' viewport cleanup (A669-5 review).**
  [Detail](backlog/ci.md#check-the-older-capture-suites-viewport-cleanup-a669-5-review).

For database fixtures filtered by business day, make the boundary explicit and exercise the
changeover. See the [testing guide](developers/testing-guide.md#a-recent-timestamp-can-belong-to-the-previous-business-day).

- **A902. Say in the testing guide that Vite also prints browser console output under an AI agent.**
  [Detail](backlog/ci.md#a902-say-in-the-testing-guide-that-vite-also-prints-browser-console-output-under-an-ai-agent).

- **A late move or second finger can overtake the gesture hold timer.**
  [Detail](backlog/ci.md#a-late-move-or-second-finger-can-overtake-the-gesture-hold-timer).

- **A891: retain input and timer timing if the missing product-information window recurs.**
  [Detail](backlog/ci.md#a891-retain-input-and-timer-timing-if-the-missing-product-information-window-recurs).

- **`apps/server/src/invoice-pdf.test.ts` took 162 s on one CI run**
  [Detail](backlog/ci.md#the-invoice-pdf-test-took-162-s-on-one-ci-run).

- **`apps/server/src/first-fiscal-hour.e2e.test.ts` sets the floor under its shard**
  [Detail](backlog/ci.md#appsserversrcfirst-fiscal-houre2etestts-sets-the-floor-under-its-shard).

- **The server's duration table is refreshed by hand.** Nothing says when
  `apps/server/test-durations.json` has gone stale. Left open by A938.
  [Receipt](developers/ci-and-gates.md#the-servers-shards-sixteen-packed-by-measured-duration)

- **The other sharded packages still use Vitest's file-count split.**
  [Detail](backlog/ci.md#the-other-sharded-packages-still-use-vitests-file-count-split)

- **Nothing checks, on every CI run, that each server test file ran in exactly one shard.**
  [Detail](backlog/ci.md#nothing-checks-on-every-ci-run-that-each-server-test-file-ran-in-exactly-one-shard)

- **Other server test files still hash fixed PINs and passwords on every test.**
  [Detail](backlog/ci.md#other-server-test-files-still-hash-fixed-pins-and-passwords-on-every-test).

- **Tests copy the dashboard shell's link handler instead of calling it.**
  [Detail](backlog/ci.md#tests-copy-the-dashboard-shells-link-handler-instead-of-calling-it).

- **A999 residual: retain the other allergy-move failure if it recurs.**
  [Detail](backlog/ci.md#a999-residual-retain-the-other-allergy-move-failure-if-it-recurs).

- **Retain failure screenshots for long browser test names.** A failed waiting-list refresh case
  in `apps/till/src/till-app.test.ts` logged `locator.screenshot: ENAMETOOLONG` during A743's
  fixture checks. Bound the generated screenshot filename and keep the complete test name in
  its metadata; verify with a deliberately failing case whose generated name is long.

- **A pnpm setup retry does not identify which command failed.**
  [Detail](backlog/ci.md#identify-which-pnpm-setup-command-failed).

- **Root guard deadlines under extreme external load (left open by A751).**
  [Detail](backlog/ci.md#at-a-load-average-near-60-more-root-guard-files-fail-on-time).

- **The bundle CLI can return success without creating output through a symlink-spelled path.**
  A994's temporary `/var/folders` invocation skipped its entry block; the canonical path worked.
  Check supported entry paths before changing the production predicate.
  [Detail](backlog/ci.md#the-bundle-clis-entry-predicate-can-skip-a-symlink-spelled-path).

- **`scripts/spawn-timeout-budget.test.ts` never judges `scripts/ci-workflow.test.mjs` or `scripts/migration-upgrade.test.ts`.**
  [Detail](backlog/ci.md#scriptsspawn-timeout-budgettestts-never-judges-scriptsci-workflowtestmjs-or-scriptsmigration-upgradetestts).

- **A624. The upgrade walk cannot step a new set whose first migration names another set's later table.**
  [Detail](backlog/ci.md#a624-the-upgrade-walk-cannot-step-a-new-set-whose-first-migration-names-another-sets-later-table).

- **The step-watch case's A544 pre-push failure is fixed at a likely cause, not a confirmed one.**
  [Detail](backlog/ci.md#the-step-watch-cases-a544-pre-push-failure-is-fixed-at-a-likely-cause-not-a-confirmed-one).

- **A1027 residual: the till shard's blocked operation is unknown.**
  [Detail](backlog/ci.md#the-till-shards-blocked-operation-is-unknown-a1027).

- **Venue-service browser startup remains unexplained (#1557).**
  [Detail](backlog/ci.md#venue-service-browser-startup-remains-unexplained-1557).

- **CodeQL's `timeout-minutes: 50` rests on the default setup's durations (A488).** codeql.yml
  saves no overlay-base database, which the default setup's runs did, so its own durations may
  differ. Next: after a week of nightly runs, read their job durations and set the limit from them
  (docs/developers/ci-and-gates.md, "Every job has a time limit").

- **A419 dashboard CI stall remains unexplained (#1474).**
  [Detail](backlog/ci.md#a419-dashboard-ci-stall-remains-unexplained-1474).

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

- **The stream pause test's frozen-bucket control failed once in CI (PR #1101, run 37108993254 attempt 1, job 111163230954, 2026-10-03; passed on re-run).**
  The original one-off race has not been reproduced locally.
  [Detail](backlog/ci.md#the-stream-pause-tests-frozen-bucket-control-failed-once-in-ci).

- **What the stream pause test's last-restore fix (A387, #1398) left open:** a local Linux run
  keeps the machine's own loopback and can still meet the stall (how often was not measured), and a
  box's restore over a real network was not measured.

- **The upgrade walk's historical runtime variation remains unexplained after reducing setup work (A736, [#1788](https://github.com/clintongormley/waitron/pull/1788)).**
  [Detail](backlog/ci.md#the-upgrade-walks-historical-runtime-variation-remains-unexplained-after-reducing-setup-work-a736-1788).

- **What moving the upgrade test's scratch directory to `/dev/shm` (A122, #856) left open:**
  [Detail](backlog/ci.md#what-moving-the-upgrade-tests-scratch-directory-to-devshm-a122-856-left-open).

- **Boot suites that release a port probe before binding still have a race (A80/#740, A907).**
  [Detail](backlog/ci.md#what-the-landing-port-fix-a80-pr-740-left-open).

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

- **Three unexplained incidents, each seen once or twice; on recurrence retain the log before retrying**
  [Detail](backlog/ci.md#three-unexplained-incidents-each-seen-once-or-twice-on-recurrence-retain-the-log-before-retrying).

- **The unexplained dashboard heading-order failure remains open** after #350. The
  `dashboard-app.a11y.test.ts` heading-order sighting is a different rule with no colour evidence,
  so nothing here explains it — treat it as still unexplained.

- **A sixth: a CI shard exited 1 with every test passing (PR #414) — the exit-1 path closed by the Vitest 4.1.11 upgrade (#437); why the call went unanswered is still open.**
  [Detail](backlog/ci.md#a-sixth-a-ci-shard-exited-1-with-every-test-passing-pr-414).

- **`bench/pglite-throughput` starts a container `pnpm reap` cannot see — OPEN (T2, 2026-09-23).**
  [Detail](backlog/ci.md#benchpglite-throughput-starts-a-container-pnpm-reap-cannot-see).

- **A throwaway script found six comments that described code that was no longer there, and it is not a guard yet**
  [Detail](backlog/ci.md#a-throwaway-script-found-six-comments-that-described-code-that-was-no-longer-there-and-it-is-not-a-guard-yet).

- **`apps/server/src/boot.mirror.test.ts`'s adoption-pending case no longer has a negative control.**
  [Detail](backlog/ci.md#appsserversrcbootmirrortesttss-adoption-pending-case-no-longer-has-a-negative-control).

- _Small:_ `test-light` reports success without naming what it ran; `packages/ui` can hang the `test-ui` shard, cause unconfirmed; the classifier's `root=`
  output line is read by no consumer.

- **Neither `working_line_contexts.unit_id` nor its write refuses an empty unit id.** The column
  is `text NOT NULL` with no foreign key or CHECK, and `recordWorkingLineContexts`
  (`packages/venue-service/src/operations.ts`) writes it unchecked. Refuse `""` there, with a case,
  or record why a sale can never carry one. Left open by A810 (#1886).

- **Loose ends left by the comment-pruning pull requests (#559 to #624).**
  [Detail](backlog/ci.md#loose-ends-left-by-the-comment-pruning-pull-requests-559-to-624).

- **`--no-verify`: the docs say "Claude never", the hook says "agents never"** — OWNER'S CALL.
  [Detail](backlog/ci.md#--no-verify-the-docs-say-claude-never-the-hook-says-agents-never).

- **The shard layout was measured against an engine that is gone** — OPEN.
  [Detail](backlog/ci.md#the-shard-layout-was-measured-against-an-engine-that-is-gone).

- **The PGlite throughput bench no longer matches the shape it says it matches** — OPEN.
  [Detail](backlog/ci.md#the-pglite-throughput-bench-no-longer-matches-the-shape-it-says-it-matches).

- **The PGlite throughput bench fails while seeding** — OPEN.
  [Detail](backlog/ci.md#the-pglite-throughput-bench-fails-while-seeding).

- **`packages/db`'s static mutants are not in its mutation score** — OPEN. Owner's call.
  [Detail](backlog/ci.md#packagesdbs-static-mutants-are-not-in-its-mutation-score).

- **`packages/ui/src/vitest-park-pointer.ts` is mutated and has no tests** — left behind by raising
  the `packages/ui` mutation score (#466, 2026-09-20). Adding a third exclusion is the consistent
  move and also shrinks the denominator `mutation-ui-aggregate`'s bar of 90 is measured against.
  Owner's call. `packages/ui/src/vitest-pointer-gestures.ts` (A720 Part 4) is in the same position.

- **`mutation.yml` repeats one shard-and-merge job pair three times** — OPEN.
  [Detail](backlog/ci.md#mutationyml-repeats-one-shard-and-merge-job-pair-three-times).

- **A pull request that changes only front-end code gets no SPA bundle built anywhere in CI**
  [Detail](backlog/ci.md#a-pull-request-that-changes-only-front-end-code-gets-no-spa-bundle-built-anywhere-in-ci).

- **The hint's cover stops at the migration run, and provisioning runs after it** (#343). A module's
  provisioning seat (`packages/catalogue/src/provisioning.ts` seeds units) executes once migrations
  succeed, outside `withDevMigrationHint`, so a seeding failure there on a stale database gets no
  curated line. Nobody has hit this.

- **`apps/server/src/rejoin-command.test.ts`'s sidecar assertions do not test the wipe** (its
  fixture closes the handles first, which removes the sidecars). The wipe's sidecar removal is
  pinned by `apps/server/src/db-wipe.test.ts`; what is missing is a rejoin-level case with sidecars
  on disk. Left open by SQLite slice 2 Task 5 (#569, `@waitron/stream`).

- **`scripts/changed-packages.mjs runnable` runs before the tests in many packages' jobs, fed from a pipe, so the selection guard does not count it and a change to it alone runs none of those jobs.**
  [Detail](backlog/ci.md#scriptschanged-packagesmjs-runnable-runs-before-the-tests-in-many-packages-jobs-fed-from-a-pipe-so-the-selection-guard-does-not-count-it-and-a-change-to-it-alone-runs-none-of-those-jobs).

- **The S3 test server's ports (C88, #920).** Fixed in the harness; the mechanism is in
  [testing-guide.md](developers/testing-guide.md), "The S3 test server knows its own server". Left:
  the Waitron servers' own ports in the loop and pause tests are drawn the same way, and a lost one
  fails the boot loudly (`server.listen_failed`) rather than silently; not changed.

- **The case "refused while the run is stopping" catches a log check blind to the stop only by the
  order two pending steps finish in:** in A538, with that check reading only the deadline, it passed
  once the refusal arrived one `setImmediate` later. Left open by #668, #686, A57, A60, #723, A538.

- **Loose ends left by SQLite slice 1 (#490 and the preparation tasks).**
  [Detail](backlog/ci.md#loose-ends-left-by-sqlite-slice-1-490-and-the-preparation-tasks).

- **After the onboarding wizard provisions, the stack started by `wa-wt onboarding <worktree>` restarted into setup mode**
  [Detail](backlog/ci.md#the-dev-launcher-looks-for-tradingenv-only-in-the-state-folder-appsserverenv-names).

- **Cross-app links in the split Vite dev stack — OPEN, unqueued.**
  [Detail](backlog/ci.md#cross-app-links-in-the-split-vite-dev-stack).

- **Loose ends left by W92 (#1250).**
  - Some dashboard pixel and drag cases W92 did not change failed once when run in parallel locally
    during the branch's work; the cause was not found. They passed in the PR's dashboard CI shard on
    its final head.

- **The guard W72d added (`scripts/id-columns-are-references.test.ts`) knows an id column only by
  its name**, so a reference named otherwise is still unseen. Left open by W72d (#1238).

- **W72h (#1247) stopped Chromium logging "ResizeObserver loop completed with undelivered notifications" from the Products tree's category name box.**
  [Detail](backlog/ci.md#chromiums-resizeobserver-loop-message-in-other-dashboard-suites-after-w72h).

- **Tests that close a dialog and then check after a single `flush` were not searched**
  [Detail](backlog/ci.md#tests-that-close-a-dialog-and-then-check-after-a-single-flush-a452-1487).

- **`pressEscape` in `packages/ui/src/components/wt-dialog.test.ts` waits a fixed 50 ms after each
  Escape.** **Next action:** decide whether "closes on a real Escape press" should wait for its
  `wt-close` instead, keeping the timer for the stays-open tests. Left open by service Task 11
  (#916). [Detail](backlog/till.md#task-11-916-cancellations-comps-and-discounts-b11ab11g)

- **`scripts/dashboard-browser-purity.test.ts` checks only some of venue-service's dashboard files**
  [Detail](backlog/ci.md#the-browser-purity-guard-checks-only-some-of-venue-services-dashboard-files).

- **Task 2's review found no test that fails when `device_profile_admission_roles` or `device_profile_admission_persons` is left out of `apps/server/src/testing/clear-provision-fixture.ts`** (read, not run).
  [Detail](backlog/ci.md#task-2s-review-found-no-test-that-fails-when-device_profile_admission_roles-or-device_profile_admission_persons-is-left-out-of-appsserversrctestingclear-provision-fixturets).

- **The payments test "refreshes only active reader statuses" failed once locally beside another
  coverage run**, then passed five times alone and in CI; not investigated. Left open by W100
  (#1332).

- **The server holds two separate 100-character limits for text a request sends**: `SEARCH_MAX`
  (`apps/server/src/orders-list.ts`, search text) and `TEXT_MAX` (`apps/server/src/orders-api.ts`, the Orders request's text fields).
  Changing one leaves the other. Left open by A454 (#1491). **Next action:** decide whether they are
  the same limit and, if so, share one constant.

- **Two browser tests failed once each during A454's work (search everywhere), and neither was reproduced or checked on `main`**
  [Detail](backlog/ci.md#two-browser-tests-failed-once-each-during-a454s-work).

- **The relocated independent department preview needs a load investigation.**
  [Detail](backlog/ci.md#the-relocated-independent-department-preview-needs-a-load-investigation).

- **A printers-screen test failed once during A435 step 2's review fixes and was not reproduced**
  [Detail](backlog/ci.md#a-printers-screen-test-failed-once-during-a435-step-2s-review-fixes).

- **The test-shape half of #339's lesson is unwritten.** #339 passed review and CI and the first
  person to open the screen got a 500; the "open it and look" half is CLAUDE.md §4's rule. The
  other half — a matrix that varies two things separately and never crosses them proves less than
  it looks — wants its own line. Left open by content languages and the image library (#339).

- **A two-transaction concurrency test that starts both sides in sequence is racing itself.**
  Nothing guards the shape; look for it in any new racing test.

- **A trap not yet in `CLAUDE.md`: `pnpm --filter <pkg> test <file> -t "name"` silently drops the
  `-t` and runs the whole file**; only a bare `--` before it passes it through. **Next action:** add
  it to `CLAUDE.md` §2's trap list, through the normal pull request flow.

- **drizzle-kit 0.31.11 left out `ON DELETE` when it generated an `ALTER TABLE … ADD … REFERENCES` on this engine, while its snapshot kept it.**
  [Detail](backlog/ci.md#drizzle-kit-03111-left-out-on-delete-when-it-generated-an-alter-table--add--references-on-this-engine-while-its-snapshot-kept-it).

### Dependency upgrades

_Formerly parts of B9 and Track C._ Open work:
[backlog/dependencies.md](backlog/dependencies.md).

- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it.**
  [Detail](backlog/dependencies.md#a-vitest-5-retry-has-to-re-measure-mutation--nothing-about-stryker-10-settles-it)

- **Bundled npm notices stop at a module-type-only package manifest.**
  [Detail](backlog/dependencies.md#npm-notices-and-module-type-only-manifests)

- **Comments and docs still name drizzle-orm 0.45.2 and 0.45.3; 0.45.4 is installed** — OPEN.
  [Detail](backlog/dependencies.md#comments-and-docs-still-name-drizzle-orm-0452-and-0453-0454-is-installed)

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  [Detail](backlog/dependencies.md#collapse-the-two-typescript-entries-back-into-one-once-typescript-eslint-supports-version-7)

- **Whether a declared floor follows the installed version is undecided — one decision for every
  manifest.**
  [Detail](backlog/dependencies.md#whether-a-declared-floor-follows-the-installed-version-is-undecided--one-decision-for-every-manifest)

- **One esbuild copy older than ours stays in the tree: `drizzle-kit`'s own range holds it.**
  [Detail](backlog/dependencies.md#one-esbuild-copy-older-than-ours-stays-in-the-tree-drizzle-kits-own-range-holds-it)

- **The root `package.json` says `"engines": { "node": ">=24" }` while `.nvmrc` says 26.**
  [Detail](backlog/dependencies.md#the-supported-node-version)

- **Only the request side of that adapter was compared between the two versions.**
  [Detail](backlog/dependencies.md#only-the-request-side-of-that-adapter-was-compared-between-the-two-versions)

- **`apps/server/src/tls.ts`'s type guarantee is still untested.**
  [Detail](backlog/dependencies.md#the-tls-options-type-guarantee-is-untested)

- **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo.**
  [Detail](backlog/dependencies.md#the-default-browser-floor-rose-and-no-browser-floor-is-stated-anywhere-in-the-repo)

- **The browser-mode packages that declare no vite follow the others' by deduplication, not by
  a declaration.**
  [Detail](backlog/dependencies.md#the-browser-mode-packages-that-declare-no-vite-follow-the-others-by-deduplication-not-by-a-declaration)

- **The dependency-optimizer fix still needs a cold-cache check on Vite 8.**
  [Detail](backlog/dependencies.md#a-dependency-optimizer-receipt-taken-on-vite-6-was-not-re-measured)

- **The till's QR pin compares the code against itself, not an authority.**
  [Detail](backlog/dependencies.md#the-tills-qr-pin-compares-the-code-against-itself-not-an-authority)

- **There is no snapshot file anywhere in the repository.**
  [Detail](backlog/dependencies.md#readable-qr-snapshot-differences)

- **`node-forge` has a high-severity security alert with no fixed version** — OPEN (Dependabot alert #20).
  [Detail](backlog/dependencies.md#node-forge-has-a-high-severity-security-alert-with-no-fixed-version)

- **Whether the vulnerability the upgrade fixes is reachable in this product is open** — left
  behind by the passkey library upgrade (#453, 2026-09-19).
  [Detail](backlog/dependencies.md#whether-the-vulnerability-the-upgrade-fixes-is-reachable-in-this-product-is-open)

- **The version-14 browser helpers are unused.** Whether `browserSupportsPasskeys()` would
  improve the login screen's `browserSupportsWebAuthnAutofill()` gate has not been assessed.

- **Dependabot's `fast-uri` security updater reports an older latest resolvable version.**
  Diagnose `security_update_not_possible` in [run 40069322027](https://github.com/clintongormley/waitron/actions/runs/40069322027):
  it reports 3.1.8 even though a targeted pnpm refresh resolves 3.1.9 without an override.

- **Dependabot's Zod security run reported an older latest resolvable version.**
  [Detail](backlog/dependencies.md#dependabots-zod-security-run-reported-an-older-latest-resolvable-version)


### Modules, data and code health

_Formerly B8, parts of B9, and the old Track C's correctness items; part of A9._ Detail: [backlog/architecture.md](backlog/architecture.md).

- **The `authorized_by` comment on `drawer_opens` says only a manual open sets it**
  [Detail](backlog/architecture.md#the-authorized_by-comment-on-drawer_opens-says-only-a-manual-open-sets-it)

- **Go-live day steps.**
  [Detail](backlog/architecture.md#go-live-day-steps).

- **A query with tens of thousands of bound values crashes before it reaches the database**
  [Detail](backlog/architecture.md#a-query-with-tens-of-thousands-of-bound-values-crashes-before-it-reaches-the-database)

- **A760. Squash every migration set before go-live.** The watcher starts the sole job after big
  work and migration branches drain, with the full Waitron/Cloud mutation freeze and named
  reset/operator roster recorded.
  [Detail](backlog/architecture.md#a760-squash-every-migration-set-before-go-live).

- **A913's fix items: general code English only (owner's answers, 2026-10-20).** The audit
  ([english-only-audit.md](backlog/english-only-audit.md)) and the owner's answers became the
  items below and A918. A918 and A963–A965 come first: they change what a venue sees. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A963. A full invoice's address: Spain's rule moves to Spain's pack, the till stores a country
  code.** `apps/server/src/invoice-selection.ts` refuses an address not ending «España» with a
  five-digit postcode; the till appends «España». Changes printed invoice text. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A964. Kitchen tickets and the order-number slip follow the venue's language, from
  `apps/server/src/i18n/`.** Build from the [implementation plan](superpowers/plans/2026-10-22-a964-kitchen-language.md),
  using the saved default content language. Recheck A807/A808 and A773-2's printing reservations
  before implementation. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A965. Spain's receipt words gain English; the card slip prints in the receipt language, and the
  refund receipt's heading moves into Spain's pack.** [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A966. The server's emails move into `apps/server/src/i18n/`** (account and missed-clocking
  emails). No visible change. After A964. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A967. The server's printed reports and test pages move into `apps/server/src/i18n/`**
  (working-time PDF frame, category sales, printer test and ruler pages), in two pull requests.
  After A964. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A968. The guide's frame and the recovery page move into `apps/server/src/i18n/`.** The recovery
  page must still load without the database. After A964. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)


- **Spanish text in a server test venue, for A913's English-only audit.**
  `apps/server/src/testing/bill-venue.ts` names its products "Paella" and "Caña", and in the look
  test's venue the Spanish refund dialog shows the reason "Mistake" in English. Found by A798-B
  slice 8 (#2012).

- **A971. Spain's pack provides English for every word it shows** (holiday names, area labels,
  notices) — check first; a holiday with two names may need a schema change. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A972. Demo data per country pack and region — DESIGN FIRST, then ask the owner.** Spain's
  pack already names its demo; the data set itself (`apps/server/scripts/demo-seed/data-sets/`)
  moves into `country-es`, plus region demos ("catalán demo in Catalunya"). After A918. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A974. Finish the remaining English names in general code.** Remaining: till app and screen
  private names, the payment widget's idle-choice and main suites, server till-API
  tests, shared station fixtures and file names. Keep fixture text with A976 and the owner-held
  core-comment PR separate. See the
  [detail](backlog/architecture.md#a913s-fix-items-general-code-english-only). Low priority.

- **Setup's receipt-language selection still reads inherited object properties.** Its
  `venue-screen.ts` lookup needs qualification with a country-pack code such as `constructor`;
  the review screen now keeps such an unknown code visible.
  [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A975. Remaining demo scripts to English** (the `*-demo.ts` scripts). Retire the fake-backend
  demos after moving their useful checks into English tests. Low priority; needed before A977
  can scan them. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A976. Finish the server's English test-venue defaults.**
  Other helpers and screen expectations remain; later cleanup goes package by package from
  A977's list. Low priority.
  [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **Cloud's cost-test fixtures still carry Spanish operation and street examples.** The two
  backend fixtures need their own English wording change in the Cloud repository.
  [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A977. Widen the English-only guard to every text file, after A918 and A963–A975.** Accented
  letters too; a shrinking-only list of test folders still to clean. [Detail](backlog/architecture.md#a913s-fix-items-general-code-english-only)

- **A646 — a Modules page where the administrator switches optional modules on and sets them up (OPEN; revised design awaits agreement).**
  [Design](superpowers/specs/2026-10-16-a646-modules-page-design.md) and [mockups](backlog/mockups/a646-modules-page/README.md).
  Build waits for owner agreement and A739; retained protection comes first. Google's access-check scope remains undecided.
  [Detail](backlog/architecture.md#a646--a-modules-page-where-the-administrator-switches-optional-modules-on-and-sets-them-up)

- **Station deletion's draft-location filter needs a discriminating test.** Add a second-location
  draft case that fails without the clause, or establish by running the real writers that it is
  redundant before removing it. Its necessity remains unverified.
  [Detail](backlog/architecture.md#station-deletions-draft-location-filter-needs-a-discriminating-test).

- **The order-line schema's variant-name comment mistakes missing customer text for a null map.**
  `packages/db/src/schema/orders.ts` says `variantDescriptions` is null when the variant has no
  customer name. The existing working-order case "names a variant line with no customer or kitchen
  name" instead reads its frozen staff-name map. Left open by A612; remove the misleading comment.

- **Loose ends left by A435's printer, reader and device delete (steps 2 to 4).**
  [Detail](backlog/architecture.md#loose-ends-left-by-a435s-printer-reader-and-device-delete-steps-2-to-4).

- **Loose ends left by A435 steps 3, 3b and 4 (#1520, #1524, #1519).** "A device that is not
  deleted" is written by hand as `isNull(devices.deletedAt)` in several files; one named check would
  keep a new query from forgetting it.
  [Detail](backlog/architecture.md#loose-ends-left-by-a435-steps-3-3b-and-4-1520-1524-1519).

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

- **`tenant_receipts`: decide the remaining DELETE restriction (A805 follow-up).**
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

- **`apps/server` route-suite test titles still say "not a 500" or that an unscreened malformed id becomes an opaque 500, although ids are text columns now.** The titles name no engine; none has
  been probed against today's behaviour. Left open by C127 (#1036, #1042) and found again by #600
  while pruning comments.
  [Detail](backlog/architecture.md#appsserver-test-titles-still-say-an-unscreened-malformed-id-becomes-an-opaque-500-although-ids-are-text-columns-now)

- **Small renames and dead exports the sweep found and could not make — OPEN (T2, 2026-09-23;
  narrowed by A92 and #1039).** Still open: `apps/server/src/working-order-reads.sqlite.test.ts` keeps
  its `.sqlite.` infix because the approved slice 3d plan ran it by that name. The
  `provisioning.invalid_identifier` error registry entry remains. [Detail](backlog/architecture.md#small-renames-and-dead-exports-the-sweep-found-and-could-not-make)

- **Prune the comments, one package per pull request — IN PROGRESS (owner decision 2026-09-23).**
  [Detail](backlog/architecture.md#prune-the-comments-one-package-per-pull-request)

- **`apps/server/README.md` (near line 496) still says an `error` line and a 503 are "the same
  condition by construction"**
  [Detail](backlog/architecture.md#appsserverreadmemd-near-line-496-still-says-an-error-line-and-a-503-are-the-same-condition-by-construction)

- **`working-order.ts` (near `requireLiveCourse`) says the fire verbs use the same live-course
  definition; `fireCourse` calls `requireCourse`**
  [Detail](backlog/architecture.md#working-orderts-near-requirelivecourse-says-the-fire-verbs-use-the-same-live-course-definition-firecourse-calls-requirecourse)

- **Pointers outside `docs/` that #597 made stale**
  [Detail](backlog/architecture.md#pointers-outside-docs-that-597-made-stale)

- **"Nothing under `apps/` may import a regime package (`scripts/module-seams.test.ts`)" … is too
  wide** — found by #567 while pruning comments. The same claim stands in
  `packages/fiscal-verifactu/src/venue-fields.ts`.
  [Detail](backlog/architecture.md#nothing-under-apps-may-import-a-regime-package-scriptsmodule-seamstestts--is-too-wide)

- **Nothing now checks at run time that a read returns something other than a Node `Buffer`**
  [Detail](backlog/architecture.md#nothing-now-checks-at-run-time-that-a-read-returns-something-other-than-a-node-buffer)

- **The nested `tx.transaction(...)` in `enqueueSuccessor` wraps one insert**
  [Detail](backlog/architecture.md#the-nested-txtransaction-in-enqueuesuccessor-wraps-one-insert)

- **`decimalToCents` refuses an amount over the bound (#583), but `centsToDecimal` itself has no
  digit bound**
  [Detail](backlog/architecture.md#decimaltocents-refuses-an-amount-over-the-bound-583-but-centstodecimal-itself-has-no-digit-bound)

- **Loose ends left by A394-3 (#1447).**
  [Detail](backlog/architecture.md#loose-ends-left-by-a394-3-1447).

- **A394-5, A394-6, A394-8 to A394-17 and A394-20 to A394-22 — refusal statuses by one rule** —
  OPEN, low priority, not queued — owner 2026-10-08: take them from here when a lane has room. (A394-1 to A394-4 landed as #1441, #1444, #1447 and #1455.) The follow-ups and the rows:
  `docs/superpowers/plans/2026-10-08-a394-refusal-statuses.md`.
  [Detail](backlog/architecture.md#a394-5-a394-6-a394-8-to-a394-17-and-a394-20-to-a394-22--refusal-statuses-by-one-rule)

- **Comments and test titles still cite sections of specs that were deleted** — OPEN (2026-09-26).
  **Next action:** fold into the comment-pruning sweeps: re-point each to
  the pull request that built the work, or drop the tag.
  [Detail](backlog/architecture.md#comments-and-test-titles-still-cite-sections-of-specs-that-were-deleted)

- **Three shapes the read connection does not cover** — OPEN (stated 2026-09-23, task N3, PR #493).
  [Detail](backlog/architecture.md#three-shapes-the-read-connection-does-not-cover)

- **Every read route now takes the venue's exclusive write lock and issues a DELETE** — OPEN.
  **Next action:** decide whether a read-only body should take the lock at all.
  [Detail](backlog/architecture.md#every-read-route-now-takes-the-venues-exclusive-write-lock-and-issues-a-delete)

- **Three copies of one SQL identifier validator and two cause-chain walkers** — OPEN.
  **Next action:** export one validator from `@waitron/shared`; `packages/store` depends only on
  `@waitron/shared`, which depends on nothing, so that edge closes no loop.
  [Detail](backlog/architecture.md#three-copies-of-one-sql-identifier-validator-and-two-cause-chain-walkers)

- **Raw engine imports in `apps/server/src/recovery-lock.ts` and
  `apps/server/scripts/cloud-backup-fixture.ts`** — left open by W45 (#1155). **Next action:**
  review each remaining raw connection separately before deciding whether a shared store API fits.
  [Detail](backlog/architecture.md#raw-engine-imports-in-appsserversrcrecovery-lockts-and-appsserverscriptscloud-backup-fixturets)

- **Files that still spell the store's file names themselves**
  [Detail](backlog/architecture.md#files-that-still-spell-the-stores-file-names-themselves)

- **Two leftovers of the restrict/trigger refusal split (#731).** `isRefusal` with
  `RESTRICT_VIOLATION` or `TRIGGER_ABORT` still reads the number alone and both stay exported (the
  `CLAUDE.md` §3 rule, unguarded, is what stands against a new caller); and the four near-identical
  word-matching checks in `packages/db/src/constraint-target.ts` could share one private helper.

- **Loose ends left by A483 (#1544).** OPEN. A start migrates, re-protects and checks only the
  modules switched on.
  [Detail](backlog/architecture.md#loose-ends-left-by-a483-1544).

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

- **Loose ends left by the tenant-column removal (#378, 2026-09-16).**
  [Detail](backlog/architecture.md#loose-ends-left-by-the-tenant-column-removal-378-2026-09-16).

- **`DrainResult.tenantsWithWork` is named for a count that can now only be 0 or 1** — left behind
  by the tenant-column removal (#378, 2026-09-16).
  [Detail](backlog/architecture.md#drainresulttenantswithwork-is-named-for-a-count-that-can-now-only-be-0-or-1)

- An `int4InRange` helper collapsing four int4-bounds parsers; an options object for the positional
  `create/updateDeviceProfile` verbs; a shared `SeedDeviceProfileInput`; a `BRAND_PRIMARY_HEX`
  constant (the theme colour is literal in three places).

- **Comments still describe a `DrizzleQueryError` wrapper that this engine does not produce.**
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

- **A1077. The core table `order_group_hold_stations` has no retention row** (added by A756 PR 6;
  `docs/superpowers/specs/2026-10-16-a664-retention-table-inventory.md`, its 2026-10-23 line); its
  retention policy is the owner's to choose.

- **A664 — archive or delete a venue's old data once it no longer has to be kept.** Revised
  proposal adopted for specialist review (owner, 2026-10-17); relevant adviser agreement,
  build and verification remain open.
  [Detail and audit](backlog/data-protection.md#a664--archive-or-delete-a-venues-old-data-once-it-no-longer-has-to-be-kept)

- **libvips is LGPL-3.0-or-later** and ships in the box image with its notices and a written
  source offer in `/app/third-party/` (`deploy/third-party/`). The legal advisor is asked to
  confirm it (`docs/compliance/action-plan.md`, 2026-09-23).
  [Detail](backlog/data-protection.md#libvips-is-lgpl-30-or-later)

- **A980 — data protection, Waitron's side.** Design revision 2 (2026-10-24) records the owner's
  ten answers; its small slices are planned. S9 and S11 wait for the specialists.
  [Detail](backlog/data-protection.md#a980--data-protection-waitrons-side)

- **A privacy-notice page hosted by Waitron Cloud.** For a Cloud-connected venue, a page Cloud
  serves from the venue's own notice text, instead of a page on the venue's own website. The owner
  chose the venue's own page for now (A980 O3, 2026-10-22), so this is not in A980's plan.

- **cairo, built into that libvips, is listed under the Mozilla Public License, and `/app/third-party/`
  carries neither its licence text nor a source offer for it**.
  **Next action:** add the licence text and source notice the answer calls for.
  [Detail](backlog/data-protection.md#cairo-built-into-that-libvips-is-listed-under-the-mozilla-public-license-and-appthird-party-carries-neither-its-licence-text-nor-a-source-offer-for-it)

### Later and parked

_Formerly the "Later and parked" paragraph under What's built._

**Later and parked** (no owner decision pending; reopen when work reaches them).
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
| 3   | Fiscal layer                 | Verifactu lib + `FiscalBackend`; settlement, R5 rectificativas, F3 canje, invoice-first; fiscal is a module (`fiscal-verifactu`, `fiscal-none`)                                                                                                                                                                                                                                                                                   | F3 asesor/XSD confirmations; the owner's real-certificate checks after A795 lands (A888); cert distribution to a promoted node; a foreign business customer's identifier type (A1a)      |
| 4   | Payment layer                | `PaymentProvider` + Stripe Terminal, manual card, integrated Stripe, Mode-3 webhook, SumUp Cloud API (#309); dashboard provider/reader configuration and adoption (#323, #329)                                                                                                                                                                                                                                                    | webhook `recordSale` hand-off; reconcile remediation UI; Tap-to-Pay on the handheld (_Payments and card readers_)                                                             |
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
remains open. **Scoped 2026-10-22 by A980:** the [data-protection design](superpowers/specs/2026-10-22-a980-data-protection-design.md)
holds the data map, the controller and processor split and the builds-versus-venue list. Its
revision 2 (2026-10-24) records the owner's answers to O1 to O10, and the
[build plan](superpowers/plans/2026-10-24-a980-data-protection-build.md) orders the slices; S4 (sign-in
details deleted at deactivation), S2a1 (the server route for a person's own data download) and
S2a2 (its README, the Profile page's Download button and the Users guide section) are built.
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
