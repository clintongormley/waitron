# A980: data protection (RGPD), Waitron's side

**Revision 2, 2026-10-24 · OWNER DECISIONS ANSWERED · NO CODE.** Revision 1 was written
2026-10-22 and revised the same day after review. Build plan:
[2026-10-24-a980-data-protection-build.md](../plans/2026-10-24-a980-data-protection-build.md).
Written as the venue's data-protection adviser at the owner's request (go-live walkthrough,
2026-10-21). Every sentence about the code cites `file:line` on `main` at `32001c2f1`; every legal
sentence carries an ID from the [provenance table](#10-provenance) with the regulation's own
words. Where the text does not settle our case, the point is a question for a privacy specialist
([Q54 to Q58](#9-questions-for-the-privacy-specialist)), not a conclusion.

**Words used here.** The **controller** (_responsable_) decides why and how personal data is used;
the **processor** (_encargado_) handles it on the controller's behalf. The **data subject**
(_interesado_) is the person the data is about. A **lawful basis** is one of the six reasons in
GDPR Article 6 that make using data legal. **Special category** data, which includes health, is
forbidden unless one of the Article 9 exceptions applies. The **AEPD** is Spain's data-protection
authority. **Append-only** tables refuse every change and deletion (CLAUDE.md §3). **The bucket**
is the online storage the box copies its whole database to once the venue sets one up.

### What changed in revision 2

- **All ten owner decisions are answered** (2026-10-22, recorded in §8). The build list follows
  them: no requests list (O7), no backup-storage check (O8), no allergy-note hint (O6), so slices
  S5, S7 and S8 are dropped; the other slices keep their numbers.
- **Staff download their own data themselves** (O5). Anyone else's data, and every customer's,
  needs a new permission that only admins hold, `personal_data.export` (§5.3). It is the name the
  roles design proposes for this one privilege
  ([A1002 design](2026-10-22-a1002-custom-roles-design.md), its permission table), so the two
  pieces of work do not invent two.
- **The privacy notice lives on the venue's own web page** (O3 (a)); a page hosted by Waitron Cloud
  is a separate backlog entry, not part of this plan.
- **Receipts and invoices:** the owner asked for research first (O4). §4.1.1 holds the finding;
  nothing is built for receipts until the specialist answers.
- **New paragraph in §2.2, "Customer data that exists today"**, because the owner wrote "info for
  customers (none yet)".
- **Code that changed since revision 1 is accounted for.** A1000 (#1961) made changing another
  person's sign-in details or status admin-only, so both deactivation routes now need the admin
  permission (§5.1). Every `file:line` was re-opened on current `main`: files changed since
  revision 1's commit (`e032e2dd0`) had each cited line found again; files that did not change keep
  their lines (`git diff e032e2dd0 32001c2f1` on each cited file).
- **The deactivation defect is still there**: a probe run on 2026-10-24 found every sign-in secret
  left behind by both routes (§5.2, item 1). S4 is first in the build order.

---

## 1. Summary

**The venue is the controller and carries the legal duties.** Waitron, the company, holds none of
a self-hosted venue's data, so it is neither controller nor processor of it. It becomes a processor
once Waitron Cloud stores or backs up the venue's data, a support session sees it, or a bug report
carries it to Waitron (for bug reports Waitron may instead be a controller: Q57). Whether passing the venue's encrypted remote-access traffic through
Waitron's relay also makes it one is a question for the specialist (§3, Q57).

**What the venue must do:** publish a privacy notice and give a short version of it to staff,
invoice customers and booking guests; keep a written record of how it uses personal data (the
small-business exemption does not seem to apply, §4.6); answer requests to see, correct or delete
data within one month; tell the AEPD about a data breach within 72 hours when it puts people at
risk; sign processor contracts with its email and backup-storage providers, and check its card
providers' terms, because some act for the venue and some answer for themselves (§3).

**What Waitron should build before go-live**, each as a small change (§5.3):

- deleting a departing employee's PIN, password, passkeys, two-factor codes and recovery codes when
  the account is deactivated, which the product already does when someone's login is reset;
- a dashboard setting for the address of the venue's own privacy-notice web page, shown in staff
  invitation emails and invoice emails;
- a staff member's own download of everything held about them, from their own account; an admin's
  download of another staff member's data, and of one invoice customer's found by tax number;
- English and Spanish templates in the help guide: the privacy notices, the record of processing
  and a breach checklist;
- a check that the log file carries no names or email addresses.

**What waits.** The retention design (A664) set checkpoints before any code may delete data on a
schedule: your approval of the approach (given 2026-10-17); then the tax adviser, a labour
specialist and a privacy specialist each agreeing the part in their field; then tests showing that
copies really expire; then a separate decision before anything touches the records that can never
change. Until the specialists agree, erasing booking and allergy details, clearing a former
employee's email a year after she leaves, and every automatic clean-up wait. A privacy line on
receipts or invoices waits for the O4 research and the specialist's answer (§4.1.1). Cloud's half
(its contract with the venue, where data is stored, support access, Cloud's retention) belongs to
lane D (§7).

**Problems found in today's code** (§5.2):

- Deactivating an employee leaves their PIN, password, passkeys and two-factor secret in the
  database, whichever of the two ways a manager deactivates them, and those copies go to the
  backup storage too.
- The privacy-notice link can only be set by editing the server's environment, which a box owner
  cannot do; staff invitations go out without it.
- One gap rather than a fault: nothing checks whether the venue's own backup storage encrypts what
  it holds or where it keeps it. You chose to build nothing for it (O8).

---

## 2. The data map

Retention words: **C-LIVE** is A664's proposed shared schedule for live business evidence (six
years is the discussion baseline, not agreed law); **POL-x** names an A664 policy row
([A664 design](2026-10-16-a664-data-retention-design.md#use-explicit-policies-and-small-evidence-groups)).
**G1 to G5** are A664's gates: G1 the tax adviser, G2 the labour specialist, G3 the privacy
specialist, G4 measured storage tests, G5 a separate decision on records that can never change.
Every period below is a proposal until G1 to G3 agree it. The A664
[field audit](2026-10-16-a664-personal-data-audit.md) lists every column; this map groups them
and checks the current code. Lawful bases are proposals for the privacy specialist. Code
references are in the last column and listed under each table.

### 2.1 Staff

| Kind | Purpose | Proposed basis (R7, R8) | How long | Ref |
| --- | --- | --- | --- | --- |
| Name, display name | run the venue, attribute work | 6(1)(b) contract | while employed; minimum identity then stays with the evidence (POL-PERSON) | s1 |
| Email, pending email, invitation and reset links | sign-in, invitations | 6(1)(b) | always while active (owner decision 2026-10-21, go-live walkthrough); after leaving: one year, then cleared, the name kept (**O1 (c)**, S11, waits for G2 and G3) | s2 |
| Phone (optional) | contact | 6(1)(b) | purpose end (POL-PERSON) | s3 |
| PIN hash, password hash (salted scrypt); two-factor secret (encrypted); Google link | secure sign-in | 6(1)(b); 6(1)(f) security | only while access is needed (POL-AUTH); **today kept after deactivation** (§5.2) | s4 |
| Passkeys, recovery codes, two-factor enrolments, passkey challenges | sign-in | as above | as above | s5 |
| Sessions (token stored as a SHA-256 hash) | stay signed in | as above | ended, never deleted | s6 |
| Role, staff roles, device admission | permissions | 6(1)(b) | while employed | s7 |
| Contract type, hours, start and end, pay rate | employment, payroll | 6(1)(b), 6(1)(c) | C-LIVE with the labour floors (A664 L6, L8) | s8 |
| Rota, availability, swaps | planning | 6(1)(b) | POL-LABOUR | s9 |
| Absences, including sick leave and a free note | leave | 6(1)(c); **health**: 9(2)(b) | POL-LABOUR, G2 and G3 | s10 |
| Working-time record (append-only) | the legal daily record | 6(1)(c), ET 34.9 (R32) | four-year floor (A664 L1) inside C-LIVE | s11 |
| Who did what: voids, refunds, drawer, order changes, sales | accountability, fraud | 6(1)(c) where fiscal, else 6(1)(f); **Q58** | C-LIVE; append-only rows stay (G5) | s12 |
| Missing-clock emails | remind staff | 6(1)(c) | POL-LABOUR-OPS | s13 |

- s1 `persons` (`packages/identity/src/schema/persons.ts:31-37`)
- s2 `persons.ts:52-62`; `management_account_actions` (`packages/identity/src/schema/management-account-actions.ts:14-19`)
- s3 `persons.ts:38`
- s4 `persons.ts:40-43`, `:64`; scrypt at `packages/identity/src/secret-hash.ts:16-20`; the two-factor secret is AES-256-GCM ciphertext (`persons.ts:42`)
- s5 `packages/identity/src/schema/webauthn.ts:13-30`, `:51-52`; `recovery-codes.ts:10-11`; `totp_enrollments` deleted by reset at `packages/identity/src/staff.ts:347`
- s6 `packages/identity/src/schema/sessions.ts:14-22`; `management-sessions.ts:15-21`; `packages/identity/src/session-token.ts:18-20`; revocation only sets `endedAt` (`staff.ts:157-167`)
- s7 `persons.ts:65`; `packages/staffing/src/schema/staffing.ts:44-46`; `packages/identity/src/schema/profile-admission.ts:31-33`
- s8 `packages/workforce/src/schema/employments.ts:15-22`
- s9 [audit, workforce](2026-10-16-a664-personal-data-audit.md#workforce-17-tables)
- s10 `packages/workforce/src/schema/absences.ts:7`, `:24-30`
- s11 `time_entries`, `pay_period_closures` (`packages/workforce/src/classification.ts:12-13`)
- s12 e.g. `sales.operator_id`, `authorized_by` (`packages/db/src/schema/sales.ts:109-111`); full list in the [core audit](2026-10-16-a664-personal-data-audit.md#core-88-tables)
- s13 `attendance_mail.recipient` ([audit](2026-10-16-a664-personal-data-audit.md#workforce-17-tables)); text at `apps/server/src/attendance-email.ts:30-39`

Tips are not staff data: a tip rides on the payer's tender, attributed to the payer
(`packages/db/src/schema/sales.ts:254-268`).

### 2.2 Customers

| Kind | Purpose | Proposed basis | How long | Ref |
| --- | --- | --- | --- | --- |
| Full-invoice recipient: name, tax number (NIF), address | issue and keep the invoice | 6(1)(c): the invoice must name the recipient (R39) and its copy must be kept (R40) | C1 floor inside C-LIVE; append-only rows never change | c1 |
| Email the invoice was sent to | send the invoice | 6(1)(b) | POL-INVOICE-AUDIT | c2 |
| Printer payloads: a full invoice's name, NIF, address; a kitchen ticket's allergy block | print | as the content | **nothing deletes a print job today**; POL-PRINT proposes one month after completion, gated | c3 |
| Booking: name (required), phone, notes, who took it; no email column, no customer record | hold a table | 6(1)(b), steps before a contract | POL-BOOKING | c4 |
| Party name typed at the till, printed on kitchen tickets | find the table's food | 6(1)(b) | C-LIVE | c5 |
| **Allergies (health, Article 9)**: who, allergens, note; frozen kitchen copies | cook safely | Article 9 exception **open**: Q48 (G3) already asks it | C-LIVE proposal, no short expiry (owner, 2026-10-16) | c6 |
| Free-text notes that may carry health or names | service | as the note's content | C-LIVE | c7 |
| Card scheme, last four digits, entry mode, authorisation code, provider references; printed slip | take and prove payment | 6(1)(b), 6(1)(c) | C-LIVE with C1 | c8 |

- c1 staged on `working_orders` (`packages/db/src/schema/orders.ts:99-102`); issued on `sales`, append-only (`sales.ts:101-104`); filed record `registros_facturacion.destinatarios`, append-only (`packages/fiscal-verifactu/src/schema/registros.ts:75`)
- c2 `invoice_deliveries.recipient` (`packages/db/src/schema/invoice-deliveries.ts:74`); staged in `working_orders.invoice_delivery` (`orders.ts:104`)
- c3 `print_jobs.payload`, raw printer bytes (`packages/db/src/schema/print-jobs.ts:50`); invoice block at `apps/server/src/receipt-document.ts:234-239`; allergy block at `apps/server/src/kitchen-ticket.ts:196-198`; "nothing deletes a job today" (`docs/backlog/printers.md:228`)
- c4 `bookings` (`packages/bookings/src/schema/bookings.ts:41-53`)
- c5 `parties.name` ([audit](2026-10-16-a664-personal-data-audit.md#core-88-tables)); ticket field at `apps/server/src/kitchen-ticket.ts:63`
- c6 `party_allergy`, `party_allergy_guests` (`packages/venue-service/src/schema/party-allergy.ts:26-42`); `ticket_item_allergies` (`packages/venue-service/src/schema/kitchen-allergy.ts:30-31`); `kitchen_notices` ([audit](2026-10-16-a664-personal-data-audit.md#venue-service-41-tables))
- c7 order, draft, ticket and kitchen notes ([audit](2026-10-16-a664-personal-data-audit.md#read-each-field-category-as-a-review-instruction))
- c8 `payments` (`packages/payments/src/schema/payments.ts:61-75`); slip at `apps/server/src/payment-slip.ts:44-48`

A company's tax number is not personal data; a sole trader's or a private customer's is (R5's
definition covers "una persona física identificada o identificable").

**Customer data that exists today.** You wrote "info for customers (none yet)". No venue is live,
so no real customer's data is on any box yet. But the product already has places for it, and a
venue starts filling them the first day it uses these features:

| Feature a venue uses | What the box then keeps about a customer | Where |
| --- | --- | --- |
| A full invoice (one that names the customer) | name, tax number (NIF), address and country, on the order while it is open and on the issued sale for good; name and NIF in the record filed with AEAT | `working_orders` (`packages/db/src/schema/orders.ts:99-102`); `sales` (`packages/db/src/schema/sales.ts:101-104`); `registros_facturacion.destinatarios` (`packages/fiscal-verifactu/src/schema/registros.ts:75`) |
| Emailing that invoice | the email address it went to | `invoice_deliveries.recipient` (`packages/db/src/schema/invoice-deliveries.ts:74`); staged in `working_orders.invoice_delivery` (`orders.ts:104`) |
| A booking | name (required), phone, notes, and which staff member took it | `bookings` (`packages/bookings/src/schema/bookings.ts:41-44`, `:53`) |
| A party name typed at the till | whatever was typed, often a surname | `parties.name` (`packages/db/src/schema/parties.ts:47`) |
| An allergy taken for a table | who (free text, up to 40 characters), which allergens, a note; frozen copies on kitchen tickets | `party_allergy_guests` (`packages/venue-service/src/schema/party-allergy.ts:40-42`); `ticket_item_allergies`, `kitchen_notices` (§2.2 c6) |
| Order and kitchen notes | free text, which can name someone or mention health | §2.2 c7 |
| A card payment | card scheme and last four digits, provider references | `payments` (`packages/payments/src/schema/payments.ts:69-70`) |
| Printing any of the above | the raw printer bytes, invoice block and allergy block included | `print_jobs.payload` (`packages/db/src/schema/print-jobs.ts:50`) |

There is no customer account, no customer table and no customer email list: a person appears only
as text on the records above. One more place holds personal data that is not a customer's: a
purchase invoice from a supplier who is a sole trader carries that person's name and NIF
(`purchase_invoices`, `packages/db/src/schema/purchase-invoices.ts:28-29`). It is business evidence
under C-LIVE like the venue's own invoices, and no slice here touches it.

### 2.3 Devices, logs and the box itself

| Kind | What it holds | How long | Ref |
| --- | --- | --- | --- |
| Device registrations | a label (personal only if it names someone, "Marta's phone"), token hash | kept; deleting a device marks it deleted and keeps the row | d1 |
| Printer and print-agent addresses | the LAN address of each printer and agent: equipment, not people | while configured | d2 |
| IP addresses, browser identifiers | **none stored** | | d3 |
| Request log | method, route pattern, status, duration; no IP, no concrete path; written at debug level | as long as the log file holding it | d4 |
| `waitron.log` | whatever modules log; the unauthenticated recovery page shows its last 200 lines, after a mask that hides only URL passwords | rotated by size: 10 MB, five files | d5 |
| Container output | the same lines, unmasked | Docker keeps 10 MB × 5 | d6 |
| Freeze reports | one file per process the watchdog kills | deleted when more than a week old, but only by a start that finds under 256 MiB free or that failed on a full disk, or by the Box status page's Free button; otherwise kept | d7 |
| Incidents | codes, parameters, who acknowledged | nothing deletes them (no delete found by grep, 2026-10-22) | d8 |
| Bug-report bundles | **planned** ("Report a problem" and automatic crash reports): kept on the box, later sent to Cloud, which files a public issue with only the stack, version and error code | not designed yet | d9 |

- d1 `devices.label`, token hash, `deleted_at` (`packages/db/src/schema/devices.ts:59-64`)
- d2 `printers.host` (`packages/db/src/schema/printers.ts:49`); `print_agents.host` (`packages/db/src/schema/print-agents.ts:21`)
- d3 no `ip_address`, `user_agent` or `remote_addr` column in any schema (grep, 2026-10-22); the user agent is read in memory only (`apps/server/src/detect-device.ts:73`); a Stripe reader's own address is passed through, not kept (`packages/payments-stripe/src/card-provider.ts:245`)
- d4 `apps/server/src/request-id.ts:27-33`
- d5 `apps/server/src/config.ts:76-79`, `:141-142`; `apps/server/src/recovery-surface.ts:14`; `apps/server/src/redact-secrets.ts:1-28`
- d6 `deploy/compose.yml:69-73`
- d7 `apps/server/src/start-space.ts:119-133` (week at `:11`, 256 MiB at `:10`, the full-disk case at `:38`); `deploy/README.md:276-280`; the Free button at `apps/server/src/free-space-now.ts:210-221`
- d8 `packages/db/src/schema/incidents.ts:35-41`
- d9 `docs/backlog/alerts.md:30-81`; A982's [plan](../plans/2026-10-22-a982-one-touch-problem-reports.md) for the manual report

_2026-10-25: A1088 added `incidents.acknowledged_note` (core migration 0190), free text a manager
writes when marking a `clock.records_misdated` alert handled, or adds afterwards; the Incidents row
predates it._

### 2.4 Copies and routes off the box

| Route | What goes | Who receives it | Protection today | Ref |
| --- | --- | --- | --- | --- |
| Backup bucket | the whole database, every table above | a bucket **the venue owns**; its provider is the venue's processor | **not encrypted by Waitron**; the secrets vault and sealed secrets inside it are encrypted; daily full copy, 168 hours of history configured; turning the copy off leaves the objects | r1 |
| Scheduled archives | the whole database | the venue's folder or bucket | encrypted under the venue's passphrase; refuses to run without one; 7 archives, 30 days; the dump is staged unencrypted (mode 0600) first | r2 |
| Recovery kit | bucket keys and the recovery key | the owner | "as sensitive as the recovery key" | r3 |
| Configuration export | every person on the staff list, **former staff included**, with name, email, phone, role (never PIN, password, two-factor or Google link); employment records with contract type, hours, dates and **pay rate**; availability | whoever downloads it | encrypted under a passphrase of at least 12 characters | r4 |
| AEAT filing | full-invoice recipient's name and NIF, not the address | AEAT, a **recipient** by legal obligation (R3) | Veri\*Factu transport | r5 |
| Card providers | amount and Waitron order references, no customer data | Stripe, SumUp, chosen by the venue | provider contract | r6 |
| Email | invitations and resets; invoice PDFs with the recipient's name, NIF and address; clock reminders | the venue's own email provider, its processor | SMTP | r7 |
| Google sign-in (optional) | Google's identifier for the person | Google | only if configured | r8 |
| Waitron Cloud | registration; "Translate all" sends menu text only ("no prices, no people and no sales"); managed snapshots refuse production | Waitron | no personal data on these paths | r9 |
| Remote access (optional) | when set up, dashboard traffic crosses Waitron's relay as encrypted bytes that end at the venue | Waitron's relay | TLS end to end; whether this makes Waitron a processor is **Q57** | r10 |
| Browser storage | dashboard: remembered email, only when Remember is ticked; till: last operator's person id, unfinished refund drafts with their typed reason, the "make now" list with dish names and free-text notes; table views keep sort and filter choices for the tab | the venue's own devices | cookies are httpOnly; the device cookie lasts a year | r11 |
| Paper | full invoice customer block; kitchen ticket allergy block; card slip | the venue's printers and bins | the venue's own handling | r12 |

- r1 `docs/developers/conventions-data.md:1412`; "a bucket you own" (`apps/dashboard/src/i18n/strings.ts:1787`); config at `packages/stream/src/litestream.ts:71-89`, history at `:79-80`; vault `packages/credentials/src/cipher.ts:3`; sealed secrets `apps/server/src/sealed-state.ts:24-30`; objects left at `apps/server/src/stream-api.ts:259`
- r2 `apps/server/src/backup-config.ts:264-268`, defaults at `:42-43`; staging at `apps/server/src/backup-sweep.ts:159-162`
- r3 `packages/stream/src/kit.ts:8-13`
- r4 `packages/identity/src/configuration-transfer.ts:1-23` (secrets omitted at `:6-17`; `persons` is not filtered by status); `packages/workforce/src/configuration-transfer.ts:1-9`; encryption at `packages/provisioning/src/configuration-transfer.ts:466-471`
- r5 `packages/fiscal-verifactu/src/backend.ts:651-653`
- r6 `packages/payments-stripe/src/device-provider.ts:82-88`; `packages/payments-sumup/src/provider.ts:193-196`
- r7 `apps/server/src/email-delivery.ts:29-37`; `apps/server/src/invoice-document.ts:136-143`
- r8 `apps/server/src/config.ts:493`
- r9 `docs/developers/cloud-connection.md:105-109`, `:322-325`
- r10 `packages/tunnel/src/client.ts:1-3`; on only when `WAITRON_TUNNEL_RELAY_URL` is set (`apps/server/src/config.ts:249-256`); Cloud remote access stays unconfigured until provisioned (`docs/developers/cloud-connection.md:12-15`)
- r11 `apps/dashboard/src/login-preference.ts:15`, `:78`; `apps/till/src/screens/till-lock-screen.ts:15`, `:274`; `apps/till/src/state/tender-refund.ts:12-15` with `apps/till/src/api/tender-refund-types.ts:9`; `apps/till/src/till-app.ts:2402-2411` with `apps/till/src/api/client.ts:2340-2349`; `packages/ui/src/components/wt-data-table.ts:1864-1872`; `apps/server/src/device-session.ts:58-65`
- r12 `apps/server/src/receipt-document.ts:234-239`; `apps/server/src/kitchen-ticket.ts:196-198`; `apps/server/src/payment-slip.ts:44-48`

---

## 3. Controller and processor

| Party | Role | Why |
| --- | --- | --- |
| The venue (the one `tenants` row, `packages/db/src/schema/tenants.ts:43-52`) | **Controller** | it "determine[s] los fines y medios del tratamiento" (R1) |
| Waitron, self-hosted box, no remote access, Cloud backup, support session or bug report | **Neither**, for venue data | it processes nothing "por cuenta del responsable" (R2) |
| Waitron, when the box uses Waitron's relay for remote access | **Open: Q57** | the relay carries only encrypted bytes, but "comunicación por transmisión" is itself processing (R44) |
| Waitron, once Cloud hosts or backs up the box, a support session opens, or a bug report leaves | **Processor** (D101's contract, R17) | it then handles venue data on the venue's behalf. Using it for Waitron's **own** purposes would make Waitron a controller (R28, R43): **Q57** |
| Bucket provider (e.g. AWS, chosen by the venue) | Venue's processor | it stores the venue's copy |
| Email provider | Venue's processor | it sends the venue's mail |
| Card providers, Google | Venue's processors, or controllers in their own right for their own regulated duties; the venue checks each one's terms | |
| AEAT | **Recipient** by legal obligation, not a processor | it receives the filing under its own law (R3) |
| Gestoría, asesor | Venue's processors or controllers | outside Waitron |

Waitron is separately the controller of its own customer relationship (the venue's account,
billing). That is not this map.

---

## 4. Waitron builds, the venue does

| Duty | Waitron builds | The venue does |
| --- | --- | --- |
| Privacy notices (R10, R23) | a setting for the address of the venue's notice page (O3 (a)); the link in invitation, login, profile and invoice emails; template texts in English and Spanish in the help guide (§4.1) | adapts and publishes the notice on its own web page; tells booking guests by phone; receipts and invoices wait for the O4 research (§4.1.1) |
| Access and portability (R11, R15) | a staff member's own download, from their own account; an admin's download of another staff member's data or of an invoice customer's found by NIF (§4.2, O5) | checks who is asking; replies within a month (R9) |
| Erasure (R13, R27) | sign-in secrets deleted at deactivation (S4); on-request erasure of booking and allergy fields after G3 (§4.3) | decides each request; replies saying what stays and why |
| Correction (R12) | already: a manager edits a person's name and phone, an admin their email, role and status (`apps/server/src/management-api.ts:1137`, `packages/identity/src/staff.ts:209-216` for the role, `:233-235` for email and status); bookings editable while booked (`packages/bookings/src/bookings.ts:159-164`) | corrects |
| Restriction, objection (R14, R16) | nothing for go-live: no requests list (O7) | decides; records a restriction in its own register (R26) |
| Retention (R6, R10) | nothing until A664's gates clear (§6) | states its periods, or how they are set, in its notice |
| Breach (R20, R21) | a breach checklist template in the help guide, English and Spanish (O10 (b), S6), saying what the box can tell (§4.5) | judges the risk; notifies the AEPD and, if high risk, the people |
| Record of processing (R18) | a template in the help guide, English and Spanish (O10 (b), S6, §4.6) | completes and keeps it, with its adviser |
| Data protection officer (R22, R29) | nothing | none required, on our reading (§4.7) |
| Security (R19) | §4.8 fixes | physical security of the box, devices and paper |
| Staff monitoring (R30, R33, R45) | the staff notice names the action log (§4.9) | informs staff; consults representatives where required |

### 4.1 Privacy notices: draft content

The law lets the venue give a short **first layer** and point to the rest: identity, purpose and
rights, plus "una dirección electrónica u otro medio que permita acceder de forma sencilla e
inmediata a la restante información" (R23). The full notice carries every item of Article 13
(R10). The drafts below use a fictional venue, **Bar Ejemplo S.L.**; the venue's adviser checks
them. In the product they are templates in the help guide, in English and Spanish (S6, O10 (b)).

**Staff** (shown today in invitation emails, account setup and the profile page when a link is
configured, `apps/server/src/account-email.ts:132`, `apps/dashboard/src/screens/login-screen.ts:1129-1138`):

> **Protección de datos.** Responsable: Bar Ejemplo S.L. (B00000000), C/ Mayor 1, Valencia,
> privacidad@barejemplo.es. Tratamos tus datos para gestionar tu contrato, tu acceso a Waitron y el
> registro diario de jornada, que la ley nos obliga a conservar cuatro años. Waitron anota qué
> persona hace cada operación de caja (anulaciones, devoluciones, apertura del cajón). Puedes
> ejercer tus derechos de acceso, rectificación, supresión, limitación, oposición y portabilidad en
> privacidad@barejemplo.es, y reclamar ante la AEPD. Más información: barejemplo.es/privacidad-personal.

_English:_ "Data protection. Controller: Bar Ejemplo S.L. … We use your data to manage your
contract, your Waitron access and the daily working-time record, which the law makes us keep for
four years. Waitron records which person performs each till operation (voids, refunds, opening the
drawer). You can exercise your rights … and complain to the AEPD. More: …"

**Invoice customers** (added to the invoice email body by S1; on paper, see §4.1.1):

> Bar Ejemplo S.L. trata tu nombre, NIF y dirección para emitir esta factura y cumplir sus
> obligaciones fiscales, incluida su remisión a la Agencia Tributaria. Derechos y más información:
> privacidad@barejemplo.es · barejemplo.es/privacidad.

_English:_ "Bar Ejemplo S.L. uses your name, tax number and address to issue this invoice and meet
its tax duties, including sending it to the Tax Agency. Rights and more: …"

S1 puts this text in the email's body, not on the PDF invoice the email attaches; Q59 (c) asks the
adviser whether the PDF itself should carry a line, so an answer of yes could put the same notice in
one email twice.

**Booking guests** (bookings are taken by staff, `packages/bookings/src/schema/bookings.ts:50-52`,
and the box sends guests nothing, so the first layer is spoken):

> «Guardamos su nombre y teléfono para la reserva. Si nos cuenta una alergia, la anotamos para
> preparar su comida con seguridad. Tiene más información en nuestra web.»

_English:_ "We keep your name and phone for the booking. If you tell us about an allergy we note
it so we can prepare your food safely. There is more on our website."

**Second layer** (the venue's own web page, O3 (a), its address set in the dashboard by S1): the
Article 13 items in R10 for each group, with the retention periods from §2 once A664's gates
settle them, and the recipients from §2.4.

#### 4.1.1 A privacy line on receipts and invoices (O4)

**Finding.** The owner doubted that receipts or invoices usually carry a privacy notice
(2026-10-22). No text we read requires one on either. The duty is to inform a
person *when their data is collected* (GDPR art. 13.1, «en el momento en que estos se obtengan»).
A **simplified receipt** names only the venue (RD 1619/2012 art. 7.1.d), so it normally collects no
personal data and starts no duty. The exception is one that carries the customer's tax number and
address because they asked: a business customer may ask (art. 7.2), and so may a private customer
who needs them «para el ejercicio de cualquier derecho de naturaleza tributaria» (art. 7.3). A
**full invoice** must carry the customer's name, tax number and address (art. 6.1.c–e). For a
private customer those are plainly personal data. For a sole trader (autónomo) they are personal
data too; LOPDGDD art. 19.2 presumes a lawful basis for using them, but only for sole traders and
professionals acting as such, and it concerns the basis, not the duty to inform. For a company they
are not personal data (GDPR recital 14). The notice is due when staff
take the details, before anything is printed. LOPDGDD art. 11 allows a short first layer (who is
responsible, why, that rights exist) plus a link or other way to reach the rest. The AEPD's guide
puts that layer «en el mismo momento y en el mismo medio en que se recojan los datos». Under the
old law a business asked the AEPD whether a sign in the shop would do, because, in the business's
words, «en las facturas y tickets no se dispone de espacio suficiente». The AEPD said yes, provided
the sign carries the information the law then required and is visible and readable, following
earlier reports including its 2007 report that the clause need not appear on a
card-payment ticket (Informe 0029/2011). RD 1619/2012 permits extra wording: «cualesquiera otras
menciones» ("any other wording"). The same sentence opens «sin perjuicio de los datos o requisitos
que puedan resultar obligatorios a otros efectos» (art. 7.1; art. 6.1 in nearly the same words),
and whether data-protection law is such an "other effect" is the question Q59 puts to the
adviser. We found no verified Spanish
restaurant footer to quote. One billing-software vendor says the text "must" appear, but it cites
no provision. The one restaurant-invoice fine we found punished asking for a phone number, not a
missing notice.

**Waitron today.** Each department's translated receipt footer (`footerMessage`) is printed by
`apps/server/src/receipt-document.ts` on every till-printed receipt, including a full invoice with
the customer's name and tax number. A search of `invoice-pdf.ts` found no footer on the PDF/A4
invoice.

**Recommendation.** Build nothing now. Until the adviser answers (Q59), a venue that wants a
notice can type a one-line first layer into that footer, for example «Datos de facturación:
[razón social], para emitir y conservar la factura (obligación legal). Derechos e información:
[url]», or show it where the details are taken (a sign at the counter). If the adviser asks for a
line on full invoices only, or on the PDF, that becomes its own backlog entry.

| Source | URL | Article | Quote (source's own words) | Paraphrase |
| --- | --- | --- | --- | --- |
| GDPR (BOE copy of the Official Journal text; the EUR-Lex HTML returned an empty body) | https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807 | Art. 13.1 | «Cuando se obtengan de un interesado datos personales relativos a él, el responsable del tratamiento, en el momento en que estos se obtengan, le facilitará toda la información indicada a continuación» | When personal data is collected from the person it is about, the controller must give the listed information at that moment. |
| GDPR | same | Art. 13.4 | «no serán aplicables cuando y en la medida en que el interesado ya disponga de la información» | No duty to inform where, and to the extent that, the person already has the information. |
| GDPR | same | Art. 12.1 | «en forma concisa, transparente, inteligible y de fácil acceso, con un lenguaje claro y sencillo … por escrito o por otros medios, inclusive, si procede, por medios electrónicos» | The information must be concise, clear and easy to reach; given in writing or by other means, including electronic ones. |
| GDPR | same | Recital 14 | «no regula el tratamiento de datos personales relativos a personas jurídicas y en particular a empresas constituidas como personas jurídicas, incluido el nombre y la forma de la persona jurídica y sus datos de contacto» | The Regulation does not cover data about companies (legal persons), including their name, legal form and contact details. |
| LOPDGDD (BOE consolidated) | https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673 | Art. 11.1 | «podrá dar cumplimiento al deber de información establecido en el artículo 13 del Reglamento (UE) 2016/679 facilitando al afectado la información básica … e indicándole una dirección electrónica u otro medio que permita acceder de forma sencilla e inmediata a la restante información» | The art. 13 duty may be met by giving basic information plus an address or other means that leads easily and at once to the rest. |
| LOPDGDD | same | Art. 11.2 | «a) La identidad del responsable del tratamiento … b) La finalidad del tratamiento. c) La posibilidad de ejercer los derechos establecidos en los artículos 15 a 22» | The basic layer must at least name the controller, the purpose and that the person's rights can be exercised. |
| LOPDGDD | same | Art. 19.2 | «La misma presunción operará para el tratamiento de los datos relativos a los empresarios individuales y a los profesionales liberales, cuando se refieran a ellos únicamente en dicha condición y no se traten para entablar una relación con los mismos como personas físicas» | Processing a sole trader's or professional's data, in that capacity only, is presumed to rest on legitimate interest. This concerns the legal basis, not the duty to inform. |
| RD 1619/2012 (BOE consolidated) | https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696 | Art. 6.1 (intro) and 6.1.c, d, e | «Toda factura y sus copias contendrán los datos o requisitos que se citan a continuación, sin perjuicio de los que puedan resultar obligatorios a otros efectos y de la posibilidad de incluir cualesquiera otras menciones»; c) «Nombre y apellidos, razón o denominación social completa, tanto del obligado a expedir factura como del destinatario» | Every invoice carries the listed contents, plus anything required by other laws, and may carry any other wording; the list includes the customer's name (and, in the cases listed, tax number and address). |
| RD 1619/2012 | same | Art. 7.1 (intro), 7.1.d, 7.2.a, 7.3 | «Sin perjuicio de los datos o requisitos que puedan resultar obligatorios a otros efectos y de la posibilidad de incluir cualesquiera otras menciones»; d) «Número de Identificación Fiscal, así como el nombre y apellidos, razón o denominación social completa del obligado a su expedición»; 7.2: «cuando el destinatario de la operación sea un empresario o profesional y así lo exija … a) Número de Identificación Fiscal … así como el domicilio del destinatario»; 7.3: «También deberán hacerse constar los datos referidos en el apartado anterior, cuando el destinatario de la operación no sea un empresario o profesional y así lo exija para el ejercicio de cualquier derecho de naturaleza tributaria» | A simplified invoice names only the seller, may carry any other wording, and carries the customer's tax number and address only when they ask for it: a business customer, or a private one who needs them to exercise a tax right. |
| AEPD, «Guía para el cumplimiento del deber de informar» (pre-May-2018 edition, watermarked "EN REVISIÓN") | https://www.aepd.es/guias/guia-modelo-clausula-informativa.pdf | §5 «Información por capas» | «presentar una información básica en un primer nivel, de forma resumida, en el mismo momento y en el mismo medio en que se recojan los datos» | Give a short first layer at the same moment, and through the same channel, as the data is collected. |
| AEPD, same guide | same | §5, additional information on paper | «Como información expuesta, claramente visible, en carteles, paneles, trípticos, etc, de los cuales se pueda solicitar una copia manejable para conservar» | The second layer may be a clearly visible sign or leaflet, if a copy can be had. |
| AEPD Gabinete Jurídico, Informe 0029/2011 (under the repealed LOPD 15/1999) | https://www.aepd.es/documento/2011-0029.pdf | Consulta and answer | «en las facturas y tickets no se dispone de espacio suficiente para incluir la información requerida»; «no sería preciso que la cláusula informativa constase expresamente en el ticket de pago»; «puede contestarse de forma afirmativa a la consulta planteada, siempre que el cartel reúna los requisitos exigidos en el número primero del artículo 5 de la Ley Orgánica 15/1999 transcrito y los de visibilidad y legibilidad» | Asked whether a shop sign could replace a notice the business said did not fit on invoices and tickets, the AEPD said yes, if the sign carries the information the old law's art. 5.1 required and is visible and readable; citing a 2007 report, it said the clause need not be on the payment ticket. Old law: persuasive only. |
| SumUp help article (vendor; no provision cited) | https://www.sumup.com/es-es/facturas/esenciales-de-facturacion/el-rgpd-y-el-texto-de-proteccion-de-datos-en-las-facturas-de-tu-programa-de-facturacion/ | — | «texto sobre protección de datos (o cláusula de privacidad) que ha de constar en las facturas. Esto no es ninguna novedad, pues la legislación en España ya obligaba a ello» | A vendor says a privacy text must appear on invoices and that Spanish law already required it. It names no provision, and none of the texts above says so. |
| Economist & Jurist (press report) | https://www.economistjurist.es/noticias-juridicas/2-000-e-de-sancion-por-solicitar-el-telefono-a-una-clienta-para-hacerle-una-factura/ | — | «ha multado con 2.000 euros a un restaurante por condicionar la emisión de una factura a que la clienta interesada en su expedición facilitase al establecimiento su número de teléfono» | The AEPD fined a restaurant for refusing an invoice unless the customer gave her phone number (press report; the reduced amount paid was €1,600). |

**Not verified from a raw source.** The AEPD resolution itself (PS/00632/2021,
https://www.aepd.es/es/documento/ps-00632-2021.pdf, the URL GDPR Enforcement Tracker names) answered
HTTP 503 on four attempts, so nothing from it is quoted. The case number comes from the tracker, not
from the AEPD. The EUR-Lex Spanish HTML came back empty, so the GDPR quotes are from the BOE's copy
of the Official Journal text. The Usercentrics article answered 403. No real Spanish restaurant
receipt or invoice footer was found to quote.

### 4.2 Access and export of one person's data

Article 15 gives a copy of the data plus purposes, recipients, retention and rights (R11);
Article 20 adds a machine-readable copy of what the person provided, where the basis is contract
or consent (R15). The venue may ask which data is meant when it holds a lot (R25), and must not
harm others' rights (R11, paragraph 4).

**Who may download what (O5).** A staff member downloads their own data themselves, from their own
account, with no permission beyond being signed in, as the working-time record already allows
(`/management-api/me/attendance/export`, `apps/server/src/attendance-export-api.ts:45-55`,
`:77-80`). Another person's data, and every customer's, needs `personal_data.export`, a new permission only
admins hold. It goes in the one permission list (`packages/identity/src/permissions.ts:5-37`),
beside `person.admin`, and in no other role's set, so admins get it through "admin holds every
permission" (`permissions.ts:76`, `:82`). The name follows the list's `area.action` form and is
the one the roles design proposes, so the coming permission review does not find two.

**Worked example, staff.** Marta López, a waitress, still works at the venue and wants to see what
it holds about her: she opens _Profile → Download my data_ and gets the ZIP below. She leaves on
30 September 2026; her account is deactivated, so she can no longer sign in. On 5 October she
emails asking for everything held about her. An admin opens _Staff → Marta López → Download her
data_ and gets the same ZIP:

```text
marta-lopez-2026-10-05.zip
  README.txt           purposes, recipients, retention, rights, in the venue's language
  profile.json         name, email, phone, role, status, created           (no hashes)
  sign-in.json         PIN set: yes/no; passkeys: names and dates; sessions: device, opened, ended
  employment.json      contract type, hours, dates, pay rate
  rota.csv             shifts, availability, swaps
  absences.csv         dates, kind, note
  time-record.pdf/.csv the existing working-time export
  actions.csv          counts per kind (voids, refunds, drawer opens), rows on request
```

2026-10-25: S2a2 writes the README in the language the person's own dashboard shows (their saved
language, else their browser's, else the venue's; the S2a2 plan's decision 1); the button is
**Download** beside **Copy of your data** on Account settings → Your details.

2026-10-25: S2b writes the work files as JSON (`employment.json`, `rota.json`, `absences.json`)
and adds `attendance.json` (workforce) and `staff-roles.json` (staffing); the working-time record
is only this node's location's (the S2b plan's decisions 2 and 6).

2026-10-25: S2c writes `actions.json`, not `actions.csv`; it holds whole sales voided after they
were recorded, refunds and cash-drawer openings, not line voids; the admin's action is **Download
their data** in the person's row menu on **Users** (the S2c plan's decisions 3, 5 and 11).

`time-record` reuses the existing export (`apps/server/src/attendance-export-api.ts:77-80`).
`actions.csv` lists sale numbers and amounts, never another person's data. The JSON files are the
Article 20 copy. Waitron keeps no list of requests (O7); the venue notes the request and its
answer in its own record.

**Worked example, invoice customer.** Jordi Puig, a self-employed electrician with NIF
12345678Z, asks what the restaurant holds about him. Today nobody can search by NIF: the orders
list recognises invoice and order numbers (`apps/server/src/orders-list.ts:237-240`) and otherwise
matches words against party, delivery and table names (`orders-list.ts:373-377`). S3 adds _Orders →
Find by tax number_, which ignores an "ES" prefix, letter case and spaces. It finds three full
invoices. The export holds the three invoice PDFs (the existing route,
`apps/server/src/orders-api.ts:364-383`), the name, NIF and address on each, the email addresses
they were sent to and when, and one line: "sent to the Agencia Tributaria as part of each invoice
record". Bookings are found separately by phone or name, because a booking holds no NIF.

### 4.3 Erasure

Erasure applies "sin dilación indebida" when a ground in Article 17(1) holds, and does not apply
where processing is needed "para el cumplimiento de una obligación legal" or for legal claims
(R13). A Spanish controller "estará obligado a bloquear los datos cuando proceda a su rectificación
o supresión" (R27): it sets the data aside so that nobody uses or even views it, except to put it
at the disposal of courts, the prosecutor or the competent authorities "para la exigencia de
posibles responsabilidades derivadas del tratamiento y solo por el plazo de prescripción de las
mismas", and then destroys it. Whether blocking also follows an erasure refused because the law
requires the data is Q56.

**(a) A former employee.** Marta asks to be forgotten.

| Data | Proposal | Why |
| --- | --- | --- |
| PIN hash, password hash, two-factor secret and enrolments, Google link, passkeys, recovery codes, pending passkey challenges | **gone at deactivation**, before any request (S4, O2) | security of processing (R19): the product already deletes exactly these on _reset login_ and on re-inviting a suspended person (`packages/identity/src/staff.ts:334-348`, `:374-391`) |
| Sessions | ended at deactivation (already, `staff.ts:157-167`); rows deleted under POL-AUTH after G3 | |
| Name | **stays** | her time entries are append-only and must stay available to her, her representatives and the Inspectorate for four years (R32) |
| Email | **O1 (c), your decision**: kept for one year after leaving, then cleared (S11, after G2 and G3); she has no active account, so the always-an-email rule does not apply | the one-year limit for contract claims with no special period (R34) |
| Phone | cleared on her request | no remaining purpose |
| Contract and pay rate, absences | stay under the labour floors (G2) | A664 L6, L8 |
| Her id on order actions | stays on append-only rows | C-LIVE, G5 |

The reply (within a month, R9) says what was erased, what stays, the law for each, and when it
will go.

**(b) An invoice customer.** Jordi asks the restaurant to forget him.

| Data | Proposal | Why |
| --- | --- | --- |
| Name, NIF, address on `sales` and in `registros_facturacion` | **stay, unchanged** | both are append-only; the invoice copy must be kept (R40); the filed record is already at AEAT |
| Copy staged on `working_orders` | candidate for clearing after A664's dependency check, after G3 | the invoice is read from `sales` (`apps/server/src/invoice-document.ts:136-143`) |
| Email address in `invoice_deliveries.recipient` | cleared on request once delivered, after G3; Q56(b) asks whether to keep it as proof of sending | |
| Raw print payload in `print_jobs` | today nothing deletes it (`docs/backlog/printers.md:228`); A664's POL-PRINT proposes deletion a month after printing, a proposal behind G3 | transport only |
| Paper copies, his inbox | outside Waitron | |

**(c) A booking guest with an allergy.** Ana García booked for 24 October, told the restaurant
"alergia al cacahuete", and dined. On 27 October she asks for deletion.

| Data | Proposal | Why |
| --- | --- | --- |
| Phone | cleared | the booking is over |
| Booking notes | read first; any allergy text not already on the order's allergy record is moved there, then the notes are cleared | free text can hold the only record of an allergy told when booking |
| Booking name (a required column, `bookings.ts:41`) | replaced by a fixed "(erased)" text; the row stays so table history adds up | A664: a required name needs a schema-compatible minimisation |
| Order allergy record (who, allergens, note) and the frozen kitchen copy | **stays on C-LIVE**; a "who" holding her name is reduced to the seat description | the owner's lean that dinner allergy evidence stays (A664, 2026-10-16), pending G3 |

Had she asked **before** the dinner, our reading is that nothing yet obliges the venue to keep the
booking, so cancelling it and clearing every field would follow; the privacy specialist confirms
this under G3. All of (c), and the email and staged-copy rows of (b), wait for G3 (§6).

### 4.4 Correction, restriction, objection

Correction already works for staff and bookings (§4 table). Restriction must "constar claramente
en los sistemas de información del responsable" (R26). With no requests list in Waitron (O7), the
venue records it in its own register; a visible marker on the record itself is a later slice, not
planned. Objection applies
to processing on legitimate interest (R16): the action log is the likely case, and the venue
decides whether its fraud and accountability grounds prevail.

### 4.5 Breach

The venue notifies the AEPD "sin dilación indebida y, de ser posible, a más tardar 72 horas
después de que haya tenido constancia" unless the breach is unlikely to be a risk (R20), and tells
the people affected when the risk is high (R21). It documents every breach either way (R20,
paragraph 5). The AEPD takes notifications through an online form on its electronic office, and
accepts an initial notification within 72 hours completed within 30 days (R38). The AEPD's
Comunica-Brecha tool helps decide whether to tell the people affected (R37). The judgement is
always the venue's; Waitron's material offers the questions, never a verdict.

**What the box can tell after an incident:** who was signed in, on which device, from when to when
(`packages/identity/src/schema/sessions.ts:14-22`); who downloaded an invoice PDF, who reprinted a
receipt, who opened the drawer ([audit](2026-10-16-a664-personal-data-audit.md#core-88-tables)).
**What it cannot tell:** who looked at a booking, a customer or a staff record, who downloaded a
configuration export, and from which address. No read is recorded and no IP is stored.

**Worked example.** On a Saturday night a till tablet is stolen. The manager revokes it
(_Devices → Revoke_, `apps/server/src/device-api.ts:743`, which ends its open sign-ins,
`docs/superpowers/specs/2026-10-08-delete-and-archive-design.md:182-184`). The breach checklist in
the help guide (S6) asks the Article 33(3) questions (R20), points to the tablet's last sessions, and lists what
a till's browser can keep (§2.4 r11): the last operator's id, unfinished refund drafts with their
typed reason, and the "make now" list with dish names and notes. The manager answers and records
the decision. Two other losses have their own entries: a lost **recovery kit** opens the whole
database in the bucket (`packages/stream/src/kit.ts:8-13`), and a leaked **configuration export**
holds every staff member's contact details and pay rate (§2.4 r4), so each asks the manager to
change the passphrase or bucket keys and to weigh notification.

### 4.6 Record of processing

The under-250 exemption does not apply where the processing "pueda entrañar un riesgo para los
derechos y libertades de los interesados, no sea ocasional, o incluya categorías especiales" (R18):
any one of those three is enough. A restaurant's staff and invoice processing is continuous, so the
exemption looks lost on that ground alone, and allergy notes are health data (R5) as well. Q54(c)
asks the specialist to confirm. Waitron ships an English and Spanish template in the help guide
(O10 (b), S6), which the venue's adviser fills in.

### 4.7 Data protection officer

Required where the controller's "actividades principales" are "el tratamiento a gran escala de
categorías especiales de datos" (R22), and for the sectors Spanish law lists (R29), which do not
include restaurants. Core activities are the controller's primary business, not processing done
as an ancillary activity (R41); one doctor or lawyer with their clients' data is not "a gran
escala" (R42, said of impact assessments). A restaurant's primary business is serving food, and its allergy notes support it,
so on our reading no officer is required; Q54(d) confirms.

### 4.8 Security of processing

Article 32 asks for measures "apropiadas … al riesgo" which include, "en su caso", "el cifrado"
(R19).

| Already | Gap |
| --- | --- |
| PINs and passwords salted scrypt (`packages/identity/src/secret-hash.ts:16-20`) | a four-digit PIN has 10,000 possible values, so its hash only slows a guesser; the bucket holds every hash (§2.4) |
| session and link tokens stored as SHA-256 (`packages/identity/src/session-token.ts:18-20`) | deactivated staff keep their secrets (§5.2) |
| secrets vault and sealed secrets encrypted (§2.4) | the database itself is unencrypted on disk and in the bucket; nothing reads the bucket's encryption or region, and you chose not to add a check (O8) |
| archives encrypted, refuse to run without a key (`apps/server/src/backup-config.ts:264-268`) | the dump is staged unencrypted first (`apps/server/src/backup-sweep.ts:159-162`) |
| LAN traffic over the box's own TLS (`apps/server/src/landing-app.ts:8`) | no record of who read personal data |
| log file masks URL passwords | the recovery page shows log lines without sign-in; whether an email-server refusal or an error naming a person reaches them is **unverified** (S10) |

### 4.9 Staff monitoring

Waitron records the staff member on every void, refund, drawer opening and order change, and the
device on every clock-in (`time_entries.captured_by_device_id`,
[audit](2026-10-16-a664-personal-data-audit.md#workforce-17-tables)). It records no location
(no `geolocation` in any app or package source, grep run 2026-10-22), no video and no sound. The
employer may adopt "las medidas que estime más oportunas de vigilancia y control" with due regard
for dignity (R33); the works committee, and staff delegates in a smaller workplace, may report
beforehand on "la implantación y revisión de sistemas de organización y control del trabajo"
(R45); the employer's digital devices need usage criteria drawn up with representatives (R30).
Whether the action log falls under any of these is Q58; the staff notice names it either way.
Missing-clock emails (`apps/server/src/attendance-email.ts:30-39`) touch the right to disconnect
(R31); when they are sent was not checked.

---

## 5. What exists today, and the gaps

### 5.1 Built

| Duty | What exists |
| --- | --- |
| Staff deactivation | two routes set `suspended` and end sessions and open links: _Deactivate_ (`apps/server/src/management-api.ts:1189-1198` → `deactivatePerson`, `packages/identity/src/staff.ts:263-291`, suspending at `:289` and revoking at `:290`) and the edit route with `status: "suspended"` (`management-api.ts:1137-1174` → `updatePersonDetails`, `staff.ts:175-261`, revoking at `:257-258`). Since A1000 (#1961) both need the admin permission, `person.admin` (`staff.ts:233-235`, `:287`); no hard delete anywhere |
| Full secret wipe | only on _reset login_ and re-inviting a suspended person (`staff.ts:310-350`, `:352-393`); the reset-PIN route deletes the PIN hash alone and ends open till sessions (`staff.ts:293-308`) |
| Working-time export | own record and manager's, PDF or CSV (`apps/server/src/attendance-export-api.ts:77-80`, `report.export` at `:45-52`) |
| Invoice PDF | one at a time (`apps/server/src/orders-api.ts:364-383`) |
| Booking end | cancel is a status; no delete verb (`packages/bookings/src/schema/bookings.ts:20-25`) |
| Privacy link | `WAITRON_PRIVACY_NOTICE_URL`, environment only (`apps/server/src/config.ts:503-511`); shown in account emails, login and profile |
| Configuration export | omits sign-in secrets; carries staff contact details, former staff included, and employment records with pay rates (§2.4 r4) |
| Anything named anonymise, erase, forget or redact for personal data | nothing |

### 5.2 Real defects today

1. **A deactivated person keeps every sign-in secret, by either route.** Both routes in §5.1 set
   `suspended` and end sessions; neither touches the PIN hash, password hash, two-factor secret,
   two-factor enrolments, Google link, passkeys, recovery codes or pending passkey challenges, all
   of which _reset login_ deletes (`packages/identity/src/staff.ts:334-348`). They stream to the
   bucket. **Still true on 2026-10-24**, by experiment: a throwaway Vitest file in
   `packages/identity` gave a staff member a PIN, password, two-factor secret, Google link, one
   recovery code, one passkey and one passkey challenge, then ran `deactivatePerson`, and on a
   second person `updatePersonDetails` with `status: "suspended"`; after both, every one of them was
   still there. The control, `resetPersonLogin` on a third person, left none. Two-factor
   enrolments (`totp_enrollments`) were not seeded. The file was deleted after the run. Fixed by S4.
2. **The privacy-notice link cannot be set on a box.** It is read only from the server's
   environment (`apps/server/src/config.ts:503`). The box's compose file passes listed variables
   into the container and this one is not among them (`deploy/compose.yml:21-41`), and the file
   setup writes holds only node, location, environment, onboarding intent and keys
   (`apps/server/src/trading-config.ts:33-41`). So neither the box's `.env` nor setup can set it,
   and invitations go out without it (`apps/server/src/account-email.ts:132`). Fixed by S1.
3. **Records with no end.** Ended sessions are never deleted; a passkey challenge that is not used
   "lapse[s] by its TTL" and stays (`packages/identity/src/passkey.ts:70-79`); incidents are never
   deleted; freeze reports go only when a start is short of disk or someone presses Free on the
   Box status page (§2.3 d7). A664's POL-AUTH and
   POL-SECURITY already cover these; they wait for G3.

**A gap, not a defect:** nothing sets or reads the bucket's encryption or region. The 2026-09-16
design's floor of provider encryption in an EU region
(`docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md:46-50`) described the
store that design chose, one prefix per venue, not the bucket the venue now owns
(`apps/dashboard/src/i18n/strings.ts:1787`). The generated config has no encryption setting
(`packages/stream/src/litestream.ts:71-89`). You chose to build nothing for it (O8), so the gap
stays and is recorded here.

### 5.3 Go-live slices

One PR each; the [build plan](../plans/2026-10-24-a980-data-protection-build.md) splits S2 into
four (S2a1 server, S2a2 dashboard, S2b, S2c) and S1 into two (S1a, S1b). Slices S5, S7 and S8 were dropped by your answers (O7, O8, O6); the others keep their
revision 1 numbers. "Fiscal" means it changes what an invoice prints or files. Text a slice shows
or writes lives in translation files with English and Spanish: the dashboard's
`apps/dashboard/src/i18n/`, and for server-written text such as the export's README a file in
`apps/server/src/i18n/`, which exists now (`box-emails.ts`, `staff.ts` and others); Spain-only
legal wording goes in `packages/country-es` with English beside it. A slice that changes a screen
updates its guide page in English and Spanish (CLAUDE.md §3).

| Slice | What | Migration | Fiscal | Permission | Tests | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| **S1** Notice settings | a dashboard setting for the address of the venue's own privacy-notice page and the controller's privacy email (O3 (a)), replacing the environment variable; the link in invitation, invoice email, login and profile | yes: no table holds a non-secret venue setting of this kind, and the receipt's JSON was considered and rejected (build plan, S1a) | no: the email body is not the invoice | `venue.configure` | setting round-trip; the link in invitation, invoice email, login and profile; an empty setting shows nothing | none |
| **S2** Staff download | §4.2's ZIP: a staff member's own, from their profile, with no permission beyond being signed in; another person's, by an admin, under the new `personal_data.export` | no | no | own: none; another's: `personal_data.export` (O5) | a fixture with a distinct value in every table that names the person, each asserted present; no hash string present (negative control: put one in and see it fail); a manager refused another person's download; a staff member gets only their own | none |
| **S3** Customer by NIF | search issued sales by recipient NIF; export §4.2 | no (build plan, S3) | no: reads only | `personal_data.export` | sole-trader fixture; `es 12345678z`, `ES12345678Z` and `12345678 Z` all find it; a company NIF is found too; nothing from other customers; a manager refused | none |
| **S4** Wipe at deactivation | delete §5.2 item 1's secrets on both deactivation routes, reusing reset login's statements; `suspendPerson` (`packages/identity/src/staff.ts:567-577`), which no route calls, the package index does not export and only its tests use, is deleted or made to wipe too, so a later route cannot bypass the wipe. **Auth change: a risk trigger, full review** | no | no | unchanged: `person.admin` for another person (§5.1) | each secret gone after _Deactivate_ and after the edit route; time entries untouched; re-inviting still works; sign-in refused | none (O2: yes) |
| **S6** Guide templates | English and Spanish help-guide pages: §4.1's privacy notices, a record of processing listing §2's activities, and a breach checklist with the Article 33(3) questions and what the box can tell (§4.5); never a verdict on whether to notify (O10 (b)) | no | no | none: guide pages | the guide pages render; ES twin with the same section ids (`apps/server/src/guide-content.test.ts`) | none |
| **S9** Booking and allergy erasure on request | §4.3(c) | no (build plan, S9) | no | `personal_data.export`, unless the permission review names one for erasure | each field cleared; allergy text moved before notes are cleared; allergy evidence kept | **G3** |
| **S10** Log check | probe whether any logged error detail carries a name or email: an email-server refusal, and error parameters such as `person.email_taken` and `person.display_name_taken` (`packages/identity/src/staff.ts:53-66`); mask it if so | no | no | none | a failing probe first | none |
| **S11** Former employee's email | O1 (c): store the date a person is deactivated; clear the email a year later and keep the name; `suspendPerson` (`staff.ts:567-577`, unrouted, used only by tests) is deleted by S4 or made to set the date too | yes: `persons` has no deactivation date (`packages/identity/src/schema/persons.ts:31-67`) | no | none: it runs on its own a year later | the date set by both routes; cleared only after the year; name kept | **G2, G3** |

2026-10-25: S2b added workforce migration 0010, three indexes for the own download's by-person
reads; no table is rebuilt.

**What a bug report may carry (O9 (a)).** Automatic reports carry only the error, the Waitron
version and log lines with personal details masked; anything a person typed travels only in a
report a manager has read and chosen to send. The bug-report work (backlog A9, and A982's plan for
the manual report) carries this rule into its own slices; it is written into that backlog entry
(`docs/backlog/alerts.md`, the A9 section).

---

## 6. How A664 folds in

| A664 already decides (adopted for specialist review, 2026-10-17) | A980 adds | Still gated by A664 |
| --- | --- | --- |
| C-LIVE, the shared six-year discussion baseline; its policy rows; holds; the archive contract; copies and restore rules; the field audit | the map by person rather than by table; controller and processor roles; notices; access, export, correction and erasure handling; breach; the record; DPO; monitoring | every retention sweep, archive and timed expiry (G1 to G3); actual copy expiry (G4); any change to append-only rows (G5) |

Nothing proposed here deletes evidence or runs on a timer before the specialists agree. S4 is not
a retention rule: it is security behaviour (R19) that the product already performs, ungated, when
a login is reset or a suspended person re-invited (`packages/identity/src/staff.ts:334-348`,
`:374-391`), extended to the moment of deactivation. You chose to build it on that basis (O2: yes),
and Q55(b) lets the privacy specialist object. S9, S11 and §5.2 item 3 wait for G3; S11 waits for
G2 as well. Q48 already
asks the specialists the Article 9 basis for allergy notes; Q54 to Q58 do not repeat it.

---

## 7. Cloud's half (D101)

**The line:** everything the venue's own software does with its data, wherever the box runs, is
A980. Everything Waitron the company does as a processor (hosting, Cloud backups, the relay,
support access, bug reports received, Cloud retention and deletion, its sub-processors and their
locations) is D101. The same box software runs in Cloud, so the rights tools in §5.3 serve Cloud
venues too; Cloud builds no second set.

**What D101 takes from this map.** The owner's Cloud answers below were given on 2026-10-21 at the
go-live walkthrough and are recorded in lane D's D101.

| D101 needs | From here |
| --- | --- |
| Article 28(3) "el tipo de datos personales y categorías de interesados" (R17) | §2's rows and their three groups (staff, customers, the box) |
| what Cloud stores and where | §2.4: the whole database once Cloud hosts or backs up; owner, 2026-10-21: in Spain, AWS `eu-south-2`, one extra copy in another EU region |
| return or deletion at the end (R17, 3(g)) | owner, 2026-10-21: a full download, backups read-only for 90 days, then deleted except Cloud's billing records |
| support access | owner, 2026-10-21: only with the venue's approval each time, time-limited, logged and visible to the venue; an emergency override logged and reported. §4.5's breach checklist points the venue at the same log |
| the relay (Q57) | §2.4 r10: whether carrying encrypted bytes makes Waitron a processor |
| breach duty, processor to controller "sin dilación indebida" (R20, paragraph 2) | a Cloud alert to the venue, which then follows its breach checklist (S6) |
| bug reports (O9, Q57) | what a report may carry (O9 (a), §5.3), and whether Waitron is processor or controller for it |
| sub-processors | AWS; owner, 2026-10-21: the translation model receives menu text only (§2.4 r9) |
| requests Cloud receives | forwarded to the venue, which answers as controller |
| a privacy-notice page Cloud hosts for a venue | not in this plan: you chose the venue's own page (O3 (a)); Cloud hosting is a separate backlog entry |

---

## 8. Owner decisions (answered 2026-10-22)

All ten were answered on 2026-10-22, relayed by the campaign watcher (about 03:45 for O1 to O5 and
03:50 for O6 to O10). Your own words are quoted where you gave them.

| | Question | Your answer | What it means for the build |
| --- | --- | --- | --- |
| **O1** | A former employee's email after she leaves | **(c)** keep it one year after she leaves, then clear it, keep her name | S11; the clearing waits for the labour and privacy specialists (G2, G3) |
| **O2** | Delete sign-in details when someone is deactivated | **yes** | S4: PIN, password, two-factor secret and enrolments, Google link, passkeys, recovery codes and pending passkey challenges, as _reset login_ already does |
| **O3** | Where the full privacy notice lives | **(a)** only: the venue's own web page, its address in a dashboard setting | S1. A page hosted by Waitron Cloud (b) is a backlog entry, not this plan |
| **O4** | A privacy line on receipts | **research first**: "I don't think receipts or invoices usually carry privacy notices, do some research and add to the assessor questions" | §4.1.1; nothing is built for receipts until the specialist answers |
| **O5** | Who may download a person's data | "staff should be able to download their own data, otherwise admins … If so, provide an admin permission" | S2 (own download, and another person's under `personal_data.export`), S3 (customers, under the same) |
| **O6** | A hint steering allergy notes away from names | **no** | S8 dropped; the field stays as it is |
| **O7** | A requests list in the dashboard | **no** | S5 dropped; the venue keeps its own record of requests and answers |
| **O8** | Warn about backup storage outside the EU or of unknown encryption | **nothing** | S7 dropped; the gap stays recorded in §5.2 |
| **O9** | What a bug report may carry | **(a)** | the rule in §5.3, carried by the bug-report work (A9) |
| **O10** | Record of processing and breach checklist | **(b)** English and Spanish templates in the help guide | S6, with the privacy-notice templates |

**Your O5 question, answered from §10's sources.** You asked whether the venue must let customers
download their data. It must give anyone it holds data about a copy when they ask: the controller
"facilitará una copia de los datos personales objeto de tratamiento" (R11), and answers "en el
plazo de un mes" (R9). The law does not require self-service, so a customer asks the venue and an
admin produces the copy (S3).

---

## 9. Questions for the privacy specialist

Added to [`docs/compliance/asesor-questions.md`](../../compliance/asesor-questions.md#data-protection-questions-for-a-privacy-specialist-added-2026-10-22)
on 2026-10-22. Q48 (G3) already asks the Article 9 basis for allergy notes.

- **Q54.** May a restaurant that records diners' allergies use the AEPD's Facilita tool, which
  "no podrá utilizarse para … datos de salud" (R36)? Confirm that the record of processing is
  required (R18) and a DPO is not (R22, R41, R42).
- **Q55.** A former employee: is keeping her email for a year after she leaves proportionate, and
  does the specialist object to deleting sign-in secrets at deactivation (S4)?
- **Q56.** When erasure is refused because the law requires the data (a former employee's time
  record, an invoice customer's details), must the venue still block it under LOPDGDD art. 32, and
  how does that sit with ET 34.9's availability to worker representatives? May the email an
  invoice was sent to be erased on request?
- **Q57.** Is Waitron a processor or a controller for bug reports it uses to fix its own software
  (R28, R43), and does relaying encrypted remote-access traffic make it a processor (R44)?
- **Q58.** Is the per-action staff log "vigilancia y control", and does it need the works
  committee's prior report (R45) or criteria drawn up with representatives (R30)?

The O4 research (§4.1.1) adds its own question about a privacy line on receipts and invoices (Q59
in the asesor list, added 2026-10-24). Q54 to Q59 belong to the later batch: the shortened list
the owner sent about 2026-10-15 did not include them, and the owner sends the next batch himself.

---

## 10. Provenance

Retrieved 2026-10-22 with `curl`, text checked with `grep` on the raw page. EUR-Lex's HTML
endpoints answered HTTP 202 with no body, so the GDPR was read from the Publications Office's
Official Journal text (`https://publications.europa.eu/resource/celex/32016R0679`, OJ L 119,
4.5.2016, Spanish and English, SHA-256 `7e6f4309…` and `962539af…`) and checked against the BOE's
copy (`https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807`). Two Spanish corrigenda change
quoted articles: [DOUE L 127, 23.5.2018](https://www.boe.es/buscar/doc.php?id=DOUE-L-2018-80845)
(Articles 9(1), 37(1)(c)) and [DOUE L 74, 4.3.2021](https://www.boe.es/buscar/doc.php?id=DOUE-L-2021-80264)
(Articles 9(2)(b), 12(3), 13, 15(1)(c), 18(1)(a), 28); quotes below use the corrected Spanish. English
corrigenda were not checked. The English column renders the OJ English text.

| ID | Claim | Source | Spanish words | English |
| --- | --- | --- | --- | --- |
| R1 | controller | GDPR 4(7) | "determine los fines y medios del tratamiento" | "determines the purposes and means of the processing" |
| R2 | processor | GDPR 4(8) | "trate datos personales por cuenta del responsable del tratamiento" | "processes personal data on behalf of the controller" |
| R3 | recipient; authorities in a particular inquiry are not | GDPR 4(9) | "no se considerarán destinatarios las autoridades públicas que puedan recibir datos personales en el marco de una investigación concreta" | "public authorities which may receive personal data in the framework of a particular inquiry … shall not be regarded as recipients" |
| R4 | breach | GDPR 4(12) | "la comunicación o acceso no autorizados a dichos datos" | "unauthorised disclosure of, or access to, personal data" |
| R5 | personal data; health data | GDPR 4(1), 4(15) | "una persona física identificada o identificable"; "datos personales relativos a la salud física o mental" | "an identified or identifiable natural person"; "related to the physical or mental health" |
| R6 | minimisation; storage limitation | GDPR 5(1)(c),(e) | "limitados a lo necesario"; "durante no más tiempo del necesario" | "limited to what is necessary"; "for no longer than is necessary" |
| R7 | bases | GDPR 6(1)(b),(c),(f) | "ejecución de un contrato"; "cumplimiento de una obligación legal"; "intereses legítimos" | "performance of a contract"; "compliance with a legal obligation"; "legitimate interests" |
| R8 | health forbidden unless an exception | GDPR 9(1), 9(2)(a),(b) | "datos relativos a la salud"; "consentimiento explícito"; "en el ámbito del Derecho laboral" | "data concerning health"; "explicit consent"; "in the field of employment" |
| R9 | one month to answer | GDPR 12(3), corrected 2021 | "sin dilación indebida y, en cualquier caso, en el plazo de un mes" | "without undue delay and in any event within one month" |
| R10 | notice contents | GDPR 13(1),(2) | "la identidad y los datos de contacto del responsable"; "el plazo durante el cual se conservarán" | "the identity and the contact details of the controller"; "the period for which the personal data will be stored" |
| R11 | access, copy, others' rights | GDPR 15(1),(3),(4) | "facilitará una copia de los datos personales"; "no afectará negativamente a los derechos y libertades de otros" | "shall provide a copy"; "shall not adversely affect the rights and freedoms of others" |
| R12 | correction | GDPR 16 | "la rectificación de los datos personales inexactos" | "rectification of inaccurate personal data" |
| R13 | erasure and its exceptions | GDPR 17(1), 17(3)(b),(e) | "sin dilación indebida"; "para el cumplimiento de una obligación legal"; "para la formulación, el ejercicio o la defensa de reclamaciones" | "without undue delay"; "for compliance with a legal obligation"; "for the establishment, exercise or defence of legal claims" |
| R14 | restriction | GDPR 18(1)(a), corrected 2021 | "impugne la exactitud de los datos personales en un plazo que permita al responsable verificar" | "accuracy … is contested … for a period enabling the controller to verify" |
| R15 | portability | GDPR 20(1) | "formato estructurado, de uso común y lectura mecánica" | "structured, commonly used and machine-readable format" |
| R16 | objection | GDPR 21(1) | "basado en lo dispuesto en el artículo 6, apartado 1, letras e) o f)" | "based on point (e) or (f) of Article 6(1)" |
| R17 | processor contract | GDPR 28(1), 28(3), 28(3)(g), corrected 2021 | "el tipo de datos personales y categorías de interesados"; "suprimirá o devolverá todos los datos personales" | "the type of personal data and categories of data subjects"; "deletes or returns all the personal data" |
| R18 | record exemption and its limits | GDPR 30(5) | "a menos que el tratamiento que realice pueda entrañar un riesgo para los derechos y libertades de los interesados, no sea ocasional, o incluya categorías especiales de datos personales" | "unless the processing it carries out is likely to result in a risk to the rights and freedoms of data subjects, the processing is not occasional, or the processing includes special categories of data" |
| R19 | security | GDPR 32(1), 32(1)(a) | "medidas técnicas y organizativas apropiadas para garantizar un nivel de seguridad adecuado al riesgo, que en su caso incluya, entre otros: a) la seudonimización y el cifrado" | "appropriate technical and organisational measures to ensure a level of security appropriate to the risk, including inter alia as appropriate: (a) the pseudonymisation and encryption" |
| R20 | notify the authority; processor to controller; contents; document | GDPR 33(1),(2),(3),(5) | "a más tardar 72 horas después de que haya tenido constancia"; "notificará sin dilación indebida al responsable"; "documentará cualquier violación" | "not later than 72 hours after having become aware"; "shall notify the controller without undue delay"; "shall document any personal data breaches" |
| R21 | tell the people when high risk | GDPR 34(1) | "probable que … entrañe un alto riesgo" | "likely to result in a high risk" |
| R22 | DPO | GDPR 37(1)(c), corrected 2018 | "las actividades principales del responsable o del encargado consistan en el tratamiento a gran escala de categorías especiales de datos con arreglo al artículo 9 o de datos personales relativos a condenas" | "the core activities of the controller … consist of processing on a large scale of special categories of data pursuant to Article 9 and personal data relating to criminal convictions" (the English says "and"; the corrected Spanish says "o") |
| R23 | layered notice | LOPDGDD 11.1-2 ([BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673)) | "información básica"; "La identidad del responsable"; "La finalidad"; "La posibilidad de ejercer los derechos" | basic information: controller, purpose, rights, and a link to the rest |
| R24 | means to exercise rights; proof on the controller; free | LOPDGDD 12.2, 12.4, 12.7; GDPR 12(5) | "La prueba del cumplimiento del deber de responder … recaerá sobre el responsable"; "Serán gratuitas … sin perjuicio de lo dispuesto en los artículos 12.5 y 15.3 del Reglamento (UE) 2016/679 y en los apartados 3 y 4 del artículo 13 de esta ley orgánica"; GDPR 12(5): "Cuando las solicitudes sean manifiestamente infundadas o excesivas" | proof of answering lies with the controller; free of charge, except as GDPR 12(5) (manifestly unfounded or excessive requests), 15(3) (further copies) and LOPDGDD 13.3 (repeated access requests) and 13.4 (a costlier means the person chooses) allow |
| R25 | ask to specify; repetitive | LOPDGDD 13.1, 13.3 | "que el afectado especifique los datos"; "en más de una ocasión durante el plazo de seis meses" | ask which data; more than once in six months may be repetitive |
| R26 | restriction must show | LOPDGDD 16.2 | "debe constar claramente en los sistemas de información del responsable" | must appear clearly in the controller's systems |
| R27 | blocking | LOPDGDD 32.1-3 | "estará obligado a bloquear los datos cuando proceda a su rectificación o supresión"; "impedir su tratamiento, incluyendo su visualización, excepto para la puesta a disposición de los datos a los jueces y tribunales, el Ministerio Fiscal o las Administraciones Públicas competentes … para la exigencia de posibles responsabilidades derivadas del tratamiento y solo por el plazo de prescripción de las mismas"; "Transcurrido ese plazo deberá procederse a la destrucción de los datos" | the controller must block data when it corrects or erases it: nobody may process or view it, except to put it at the disposal of courts, the prosecutor or competent authorities to pursue liabilities arising from the processing, and only while those liabilities can still be pursued; then it must be destroyed |
| R28 | a processor using data for itself is a controller | LOPDGDD 33.2 | "quien figurando como encargado utilizase los datos para sus propias finalidades" | whoever, appearing as processor, uses the data for its own purposes |
| R29 | DPO sector list | LOPDGDD 34.1 | "en todo caso, cuando se trate de las siguientes entidades" (letters a to o; no restaurants) | in every case for the listed entities |
| R30 | employer devices | LOPDGDD 87.2-3 | "a los solos efectos de controlar el cumplimiento de las obligaciones laborales o estatutarias y de garantizar la integridad de dichos dispositivos"; "En su elaboración deberán participar los representantes de los trabajadores" | 87.2: the employer may access the contents of devices it provides only to check compliance with work or statutory duties and to protect the devices; 87.3: representatives take part in drawing up the usage criteria |
| R31 | disconnection | LOPDGDD 88.1 | "derecho a la desconexión digital" | right to digital disconnection |
| R32 | time record kept and available | ET 34.9 ([BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2015-11430)) | "conservará los registros … durante cuatro años y permanecerán a disposición de las personas trabajadoras, de sus representantes legales y de la Inspección" | keep four years, available to workers, their representatives and the Inspectorate |
| R33 | employer control | ET 20.3 | "las medidas que estime más oportunas de vigilancia y control para verificar el cumplimiento por el trabajador de sus obligaciones y deberes laborales, guardando en su adopción y aplicación la consideración debida a su dignidad" | the surveillance and control measures it sees fit to check that workers meet their duties, with due regard for their dignity |
| R34 | contract claims window | ET 59.1 | "Las acciones derivadas del contrato de trabajo que no tengan señalado plazo especial prescribirán al año de su terminación" | contract claims with no special period expire one year after the contract ends (dismissal has its own 20 working days, 59.3) |
| R35 | business records six years | Código de Comercio 30.1 ([BOE](https://www.boe.es/buscar/act.php?id=BOE-A-1885-6627)) | "durante seis años, a partir del último asiento realizado en los libros" | six years from the last book entry (A664 F01, re-checked) |
| R36 | Facilita not for health data | [AEPD, Facilita RGPD](https://www.aepd.es/guias-y-herramientas/herramientas/facilita-rgpd) | "no podrá utilizarse para tratamientos que impliquen un alto riesgo …, como datos de salud" | cannot be used for high-risk processing such as health data |
| R37 | breach-communication aid | [AEPD, Comunica-Brecha RGPD](https://www.aepd.es/guias-y-herramientas/herramientas/comunica-brecha-rgpd) | "valorar la obligación de informar a las personas físicas afectadas" | helps decide whether to tell the people affected |
| R38 | the AEPD's form; initial notification | [AEPD, Guía para la notificación de brechas](https://www.aepd.es/guias/guia-brechas-seguridad.pdf), June 2021 | "un formulario en línea … a través de su Sede Electrónica"; "notificación de tipo "inicial", antes de las 72 horas"; "Antes del plazo máximo de 30 días" | online form; initial notice within 72 hours; complete within 30 days |
| R39 | a full invoice names the recipient | RD 1619/2012 art. 6.1(c) ([BOE](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696)) | "Nombre y apellidos, razón o denominación social completa, tanto del obligado a expedir factura como del destinatario" | the full names of issuer and recipient |
| R40 | keep issued invoice copies | RD 1619/2012 art. 19.1(b) | "Las copias o matrices de las facturas expedidas" | copies of issued invoices (A664 F12, re-checked) |
| R41 | core activities | GDPR recital 97 | "las actividades principales de un responsable están relacionadas con sus actividades primarias y no están relacionadas con el tratamiento de datos personales como actividades auxiliares" | "the core activities of a controller relate to its primary activities and do not relate to the processing of personal data as ancillary activities" |
| R42 | not large scale (said of impact assessments) | GDPR recital 91 | "no debe considerarse a gran escala si lo realiza, respecto de datos personales de pacientes o clientes, un solo médico, otro profesional de la salud o abogado" | "should not be considered to be on a large scale if the processing concerns personal data from patients or clients by an individual physician, other health care professional or lawyer" |
| R43 | a processor that infringes this Regulation by determining the purposes and means of processing is considered a controller for that processing | GDPR 28(10) | "si un encargado del tratamiento infringe el presente Reglamento al determinar los fines y medios del tratamiento, será considerado responsable del tratamiento con respecto a dicho tratamiento" | "if a processor infringes this Regulation by determining the purposes and means of processing, the processor shall be considered to be a controller in respect of that processing" |
| R44 | transmission is processing | GDPR 4(2) | "conservación … comunicación por transmisión" | "storage … disclosure by transmission" |
| R45 | works committee reports beforehand on control systems | ET 64.5(f), 62.2 | "emitir informe, con carácter previo a la ejecución por parte del empresario de las decisiones adoptadas por este, sobre las siguientes cuestiones: … f) La implantación y revisión de sistemas de organización y control del trabajo"; 62.2: staff delegates "tendrán las mismas competencias establecidas para los comités de empresa" | the works committee may report, before the employer acts, on introducing or revising systems of work organisation and control; staff delegates have the same powers |

**Not verified:** the AEPD's general breach page answered 403, so R38 relies on its 2021 guide;
when missing-clock emails are sent (§4.9); whether any logged error carries a name or email into
`waitron.log` (S10); whether old objects actually leave a provider's bucket (A664 G4). The
deactivation probe (§5.2 item 1) was re-run for revision 2 on 2026-10-24.
