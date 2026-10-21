# A980: data protection (RGPD), Waitron's side

**PROPOSED · OWNER DECISIONS PENDING · NO CODE · 2026-10-22, revised the same day after review.**
Written as the venue's data-protection adviser at the owner's request (go-live walkthrough,
2026-10-21). Every sentence about the code cites `file:line` at commit `e032e2dd0`; every legal
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

- a dashboard setting for the link to the venue's privacy notice, shown in staff invitation emails
  and invoice emails;
- a download of everything held about one staff member, and about one invoice customer found by tax
  number;
- deleting a departing employee's PIN, password, passkeys and two-factor codes when the account is
  deactivated, which the product already does when a manager resets someone's login;
- a small list of incoming requests with their one-month deadline;
- a warning on the Backups page when the backup storage is outside the EU or does not say it
  encrypts;
- a hint that steers allergy notes towards "seat 2" rather than a guest's name;
- help-guide pages for all of it.

**What waits.** The retention design (A664) set checkpoints before any code may delete data on a
schedule: your approval of the approach (given 2026-10-17); then the tax adviser, a labour
specialist and a privacy specialist each agreeing the part in their field; then tests showing that
copies really expire; then a separate decision before anything touches the records that can never
change. Until the specialists agree, erasing booking and allergy details, clearing a former
employee's email after a set time, and every automatic clean-up wait. Changing what an invoice
prints is a tax change and waits for you (O4). Cloud's half (its contract with the venue, where
data is stored, support access, Cloud's retention) belongs to lane D (§7).

**Problems found in today's code** (§5.2):

- Deactivating an employee leaves their PIN, password, passkeys and two-factor secret in the
  database, whichever of the two ways a manager deactivates them, and those copies go to the
  backup storage too.
- The privacy-notice link can only be set by editing the server's environment, which a box owner
  cannot do; staff invitations go out without it.
- One gap rather than a fault: nothing checks whether the venue's own backup storage encrypts what
  it holds or where it keeps it.

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
| Email, pending email, invitation and reset links | sign-in, invitations | 6(1)(b) | always while active (owner decision 2026-10-21, go-live walkthrough); after leaving: **O1** | s2 |
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
- s5 `packages/identity/src/schema/webauthn.ts:13-30`, `:51-52`; `recovery-codes.ts:10-11`; `totp_enrollments` deleted by reset at `packages/identity/src/staff.ts:317`
- s6 `packages/identity/src/schema/sessions.ts:14-22`; `management-sessions.ts:15-21`; `packages/identity/src/session-token.ts:18-20`; revocation only sets `endedAt` (`staff.ts:125-140`)
- s7 `persons.ts:65`; `packages/staffing/src/schema/staffing.ts:44-46`; `packages/identity/src/schema/profile-admission.ts:31-33`
- s8 `packages/workforce/src/schema/employments.ts:15-22`
- s9 [audit, workforce](2026-10-16-a664-personal-data-audit.md#workforce-17-tables)
- s10 `packages/workforce/src/schema/absences.ts:7`, `:24-30`
- s11 `time_entries`, `pay_period_closures` (`packages/workforce/src/classification.ts:12-13`)
- s12 e.g. `sales.operator_id`, `authorized_by` (`packages/db/src/schema/sales.ts:109-111`); full list in the [core audit](2026-10-16-a664-personal-data-audit.md#core-88-tables)
- s13 `attendance_mail.recipient` ([audit](2026-10-16-a664-personal-data-audit.md#workforce-17-tables)); text at `apps/server/src/attendance-email.ts:40-50`

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

- c1 staged on `working_orders` (`packages/db/src/schema/orders.ts:98-101`); issued on `sales`, append-only (`sales.ts:101-104`); filed record `registros_facturacion.destinatarios`, append-only (`packages/fiscal-verifactu/src/schema/registros.ts:75`)
- c2 `invoice_deliveries.recipient` (`packages/db/src/schema/invoice-deliveries.ts:74`); staged in `working_orders.invoice_delivery` (`orders.ts:103`)
- c3 `print_jobs.payload`, raw printer bytes (`packages/db/src/schema/print-jobs.ts:50`); invoice block at `apps/server/src/receipt-document.ts:234-239`; allergy block at `apps/server/src/kitchen-ticket.ts:196-198`; "nothing deletes a job today" (`docs/backlog/printers.md:197`)
- c4 `bookings` (`packages/bookings/src/schema/bookings.ts:41-53`)
- c5 `parties.name` ([audit](2026-10-16-a664-personal-data-audit.md#core-88-tables)); ticket field at `apps/server/src/kitchen-ticket.ts:63`
- c6 `party_allergy`, `party_allergy_guests` (`packages/venue-service/src/schema/party-allergy.ts:26-42`); `ticket_item_allergies` (`packages/venue-service/src/schema/kitchen-allergy.ts:30-31`); `kitchen_notices` ([audit](2026-10-16-a664-personal-data-audit.md#venue-service-41-tables))
- c7 order, draft, ticket and kitchen notes ([audit](2026-10-16-a664-personal-data-audit.md#read-each-field-category-as-a-review-instruction))
- c8 `payments` (`packages/payments/src/schema/payments.ts:61-75`); slip at `apps/server/src/payment-slip.ts:44-48`

A company's tax number is not personal data; a sole trader's or a private customer's is (R5's
definition covers "una persona física identificada o identificable").

### 2.3 Devices, logs and the box itself

| Kind | What it holds | How long | Ref |
| --- | --- | --- | --- |
| Device registrations | a label (personal only if it names someone, "Marta's phone"), token hash | kept; deleting a device marks it deleted and keeps the row | d1 |
| Printer and print-agent addresses | the LAN address of each printer and agent: equipment, not people | while configured | d2 |
| IP addresses, browser identifiers | **none stored** | | d3 |
| Request log | method, route pattern, status, duration; no IP, no concrete path; written at debug level | as long as the log file holding it | d4 |
| `waitron.log` | whatever modules log; the unauthenticated recovery page shows its last 200 lines, after a mask that hides only URL passwords | rotated by size: 10 MB, five files | d5 |
| Container output | the same lines, unmasked | Docker keeps 10 MB × 5 | d6 |
| Freeze reports | one file per process the watchdog kills | deleted when more than a week old, but only by a start that finds under 256 MiB free or that failed on a full disk; otherwise kept | d7 |
| Incidents | codes, parameters, who acknowledged | nothing deletes them (no delete found by grep, 2026-10-22) | d8 |
| Bug-report bundles | **planned** ("Report a problem" and automatic crash reports): kept on the box, later sent to Cloud, which files a public issue with only the stack, version and error code | not designed yet | d9 |

- d1 `devices.label`, token hash, `deleted_at` (`packages/db/src/schema/devices.ts:59-64`)
- d2 `printers.host` (`packages/db/src/schema/printers.ts:49`); `print_agents.host` (`packages/db/src/schema/print-agents.ts:21`)
- d3 no `ip_address`, `user_agent` or `remote_addr` column in any schema (grep, 2026-10-22); the user agent is read in memory only (`apps/server/src/detect-device.ts:73`); a Stripe reader's own address is passed through, not kept (`packages/payments-stripe/src/card-provider.ts:245`)
- d4 `apps/server/src/request-id.ts:27-33`
- d5 `apps/server/src/config.ts:76-79`, `:141-142`; `apps/server/src/recovery-surface.ts:14`; `apps/server/src/redact-secrets.ts:1-28`
- d6 `deploy/compose.yml:69-73`
- d7 `apps/server/src/start-space.ts:119-133` (week at `:11`, 256 MiB at `:10`, the full-disk case at `:38`); `deploy/README.md:254-258`
- d8 `packages/db/src/schema/incidents.ts:35-41`
- d9 `docs/backlog/alerts.md:20-44`

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

- r1 `docs/developers/conventions-data.md:1411`; "a bucket you own" (`apps/dashboard/src/i18n/strings.ts:1795`); config at `packages/stream/src/litestream.ts:71-89`, history at `:79-80`; vault `packages/credentials/src/cipher.ts:3`; sealed secrets `apps/server/src/sealed-state.ts:24-30`; objects left at `apps/server/src/stream-api.ts:259`
- r2 `apps/server/src/backup-config.ts:264-268`, defaults at `:42-43`; staging at `apps/server/src/backup-sweep.ts:157-158`
- r3 `packages/stream/src/kit.ts:8-13`
- r4 `packages/identity/src/configuration-transfer.ts:1-23` (secrets omitted at `:6-17`; `persons` is not filtered by status); `packages/workforce/src/configuration-transfer.ts:1-9`; encryption at `packages/provisioning/src/configuration-transfer.ts:467-472`
- r5 `packages/fiscal-verifactu/src/backend.ts:636-638`
- r6 `packages/payments-stripe/src/device-provider.ts:82-88`; `packages/payments-sumup/src/provider.ts:192-195`
- r7 `apps/server/src/email-delivery.ts:21-31`; `apps/server/src/invoice-document.ts:136-143`
- r8 `apps/server/src/config.ts:493`
- r9 `docs/developers/cloud-connection.md:105-109`, `:322-325`
- r10 `packages/tunnel/src/client.ts:1-3`; on only when `WAITRON_TUNNEL_RELAY_URL` is set (`apps/server/src/config.ts:249-256`); Cloud remote access stays unconfigured until provisioned (`docs/developers/cloud-connection.md:12-15`)
- r11 `apps/dashboard/src/login-preference.ts:15`, `:78`; `apps/till/src/screens/till-lock-screen.ts:15`, `:274`; `apps/till/src/state/tender-refund.ts:12-15` with `apps/till/src/api/tender-refund-types.ts:9`; `apps/till/src/till-app.ts:2291-2300` with `apps/till/src/api/client.ts:2312-2321`; `packages/ui/src/components/wt-data-table.ts:1864-1872`; `apps/server/src/device-session.ts:58-65`
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
| Privacy notices (R10, R23) | a setting for the notice link; the link in invitation, login, profile and invoice emails; template texts in English and Spanish (§4.1) | adapts and publishes the notice; tells booking guests by phone; puts a short line in the receipt footer if it wants one (O4) |
| Access and portability (R11, R15) | one person's export: staff, and invoice customer by NIF (§4.2) | checks who is asking; replies within a month (R9) |
| Erasure (R13, R27) | sign-in secrets deleted at deactivation (S4); on-request erasure of booking and allergy fields after G3 (§4.3) | decides each request; replies saying what stays and why |
| Correction (R12) | already: a manager edits a person (`apps/server/src/management-api.ts:1142`); bookings editable while booked (`packages/bookings/src/bookings.ts:159-164`) | corrects |
| Restriction, objection (R14, R16) | a register entry that shows the restriction (R26) | decides |
| Retention (R6, R10) | nothing until A664's gates clear (§6) | states its periods, or how they are set, in its notice |
| Breach (R20, R21) | O10: a checklist page, or templates in the guide; either way what the box can tell (§4.5) | judges the risk; notifies the AEPD and, if high risk, the people |
| Record of processing (R18) | O10: a drafted record, or a template in the guide (§4.6) | completes and keeps it |
| Data protection officer (R22, R29) | nothing | none required, on our reading (§4.7) |
| Security (R19) | §4.8 fixes | physical security of the box, devices and paper |
| Staff monitoring (R30, R33, R45) | the staff notice names the action log (§4.9) | informs staff; consults representatives where required |

### 4.1 Privacy notices: draft content

The law lets the venue give a short **first layer** and point to the rest: identity, purpose and
rights, plus "una dirección electrónica u otro medio que permita acceder de forma sencilla e
inmediata a la restante información" (R23). The full notice carries every item of Article 13
(R10). The drafts below use a fictional venue, **Bar Ejemplo S.L.**; the venue's adviser checks
them. In the product they live in translation files with English beside them (§5.3).

**Staff** (shown today in invitation emails, account setup and the profile page when a link is
configured, `apps/server/src/account-email.ts:131`, `apps/dashboard/src/screens/login-screen.ts:1129-1138`):

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

**Invoice customers** (added to the invoice email body by S1; on paper only through the venue's
own receipt footer, O4):

> Bar Ejemplo S.L. trata tu nombre, NIF y dirección para emitir esta factura y cumplir sus
> obligaciones fiscales, incluida su remisión a la Agencia Tributaria. Derechos y más información:
> privacidad@barejemplo.es · barejemplo.es/privacidad.

_English:_ "Bar Ejemplo S.L. uses your name, tax number and address to issue this invoice and meet
its tax duties, including sending it to the Tax Agency. Rights and more: …"

**Booking guests** (bookings are taken by staff, `packages/bookings/src/schema/bookings.ts:50-52`,
and the box sends guests nothing, so the first layer is spoken):

> «Guardamos su nombre y teléfono para la reserva. Si nos cuenta una alergia, la anotamos para
> preparar su comida con seguridad. Tiene más información en nuestra web.»

_English:_ "We keep your name and phone for the booking. If you tell us about an allergy we note
it so we can prepare your food safely. There is more on our website."

**Second layer** (the venue's web page): the Article 13 items in R10 for each group, with the
retention periods from §2 once A664's gates settle them, and the recipients from §2.4.

### 4.2 Access and export of one person's data

Article 15 gives a copy of the data plus purposes, recipients, retention and rights (R11);
Article 20 adds a machine-readable copy of what the person provided, where the basis is contract
or consent (R15). The venue may ask which data is meant when it holds a lot (R25), and must not
harm others' rights (R11, paragraph 4).

**Worked example, staff.** Marta López, a waitress, left on 30 September 2026 and emails on
5 October asking for everything held about her. A manager with the export permission (O5) opens
_Staff → Marta López → Download her data_ and gets one ZIP:

```text
marta-lopez-2026-10-05.zip
  README.txt           purposes, recipients, retention, rights, in the venue's language
  profile.json         name, email, phone, role, status, created           (no hashes)
  sign-in.json         PIN set: yes; passkeys: names and dates; sessions: device, opened, ended
  employment.json      contract type, hours, dates, pay rate
  rota.csv             shifts, availability, swaps
  absences.csv         dates, kind, note
  time-record.pdf/.csv the existing working-time export
  actions.csv          counts per kind (voids, refunds, drawer opens), rows on request
```

`time-record` reuses the existing export (`apps/server/src/attendance-export-api.ts:77-80`).
`actions.csv` lists sale numbers and amounts, never another person's data. The JSON files are the
Article 20 copy. Every export is recorded in the requests register (S5) if O7 is yes.

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
| PIN hash, password hash, two-factor secret and enrolments, Google link, passkeys, recovery codes, pending passkey challenges | **gone at deactivation**, before any request (S4, O2) | security of processing (R19): the product already deletes exactly these on _reset login_ and on re-inviting a suspended person (`packages/identity/src/staff.ts:303-318`, `:322-357`) |
| Sessions | ended at deactivation (already, `staff.ts:125-140`); rows deleted under POL-AUTH after G3 | |
| Name | **stays** | her time entries are append-only and must stay available to her, her representatives and the Inspectorate for four years (R32) |
| Email | **O1**: kept for one year after leaving, then cleared; she has no active account, so the always-an-email rule does not apply | the one-year limit for contract claims with no special period (R34) |
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
| Raw print payload in `print_jobs` | today nothing deletes it (`docs/backlog/printers.md:197`); A664's POL-PRINT proposes deletion a month after printing, a proposal behind G3 | transport only |
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
en los sistemas de información del responsable" (R26): the requests register (S5) records it
against the person, and a visible marker on the record itself is a later slice. Objection applies
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
(_Devices → Revoke_, `apps/server/src/device-api.ts:691`, which ends its open sign-ins,
`docs/superpowers/specs/2026-10-08-delete-and-archive-design.md:182-184`). The breach material
(O10) asks the Article 33(3) questions (R20), points to the tablet's last sessions, and lists what
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
asks the specialist to confirm. O10 decides whether Waitron drafts the record in the dashboard or
ships a template in the guide.

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
| secrets vault and sealed secrets encrypted (§2.4) | the database itself is unencrypted on disk and in the bucket; nothing reads the bucket's encryption or region (S7) |
| archives encrypted, refuse to run without a key (`apps/server/src/backup-config.ts:264-268`) | the dump is staged unencrypted first (`apps/server/src/backup-sweep.ts:157-158`) |
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
Missing-clock emails (`apps/server/src/attendance-email.ts:40-50`) touch the right to disconnect
(R31); when they are sent was not checked.

---

## 5. What exists today, and the gaps

### 5.1 Built

| Duty | What exists |
| --- | --- |
| Staff deactivation | two routes set `suspended` and end sessions and open links: _Deactivate_ (`apps/server/src/management-api.ts:1194` → `packages/identity/src/staff.ts:228-255`) and the edit route with `status: "suspended"` (`management-api.ts:1142-1179` → `updatePersonDetails`, `staff.ts:148-226`, revoking at `:224-225`); no hard delete anywhere |
| Full secret wipe | only on _reset login_ and re-inviting a suspended person (`staff.ts:296-320`, `:322-357`); the manager's reset-PIN route deletes the PIN hash alone and ends open sessions (`staff.ts:257-275`) |
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
   of which _reset login_ deletes (`packages/identity/src/staff.ts:303-318`). They stream to the
   bucket. The claim check reported a Vitest probe on 2026-10-22 (deactivate: every secret still
   present; reset login: all wiped); I did not re-run it. Fixed by S4.
2. **The privacy-notice link cannot be set on a box.** It is read only from the server's
   environment (`apps/server/src/config.ts:503`). The box's compose file passes listed variables
   into the container and this one is not among them (`deploy/compose.yml:21-41`), and the file
   setup writes holds only node, location, environment, onboarding intent and keys
   (`apps/server/src/trading-config.ts:33-41`). So neither the box's `.env` nor setup can set it,
   and invitations go out without it (`apps/server/src/account-email.ts:131`). Fixed by S1.
3. **Records with no end.** Ended sessions are never deleted; a passkey challenge that is not used
   "lapse[s] by its TTL" and stays (`packages/identity/src/passkey.ts:70-79`); incidents are never
   deleted; freeze reports go only when a start is short of disk (§2.3 d7). A664's POL-AUTH and
   POL-SECURITY already cover these; they wait for G3.

**A gap, not a defect:** nothing sets or reads the bucket's encryption or region. The 2026-09-16
design's floor of provider encryption in an EU region
(`docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md:46-50`) described the
store that design chose, one prefix per venue, not the bucket the venue now owns
(`apps/dashboard/src/i18n/strings.ts:1795`). The generated config has no encryption setting
(`packages/stream/src/litestream.ts:71-89`). Prior art for reading it: the AWS rehearsal tool
reads its own scratch bucket's default encryption (`apps/server/src/testing/aws-rehearsal.ts:874-893`).
S7 closes the gap.

### 5.3 Go-live slices

One PR each. "Fiscal" means it changes what an invoice prints or files. Text a slice shows or
writes lives in translation files with English and Spanish: the dashboard's
`apps/dashboard/src/i18n/`, and for server-written text such as the export's README a new
`apps/server/src/i18n/` file, the home CLAUDE.md §3 names for an app; Spain-only legal wording
goes in `packages/country-es` with English beside it.

| Slice | What | Migration | Fiscal | Permission | Tests | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| **S1** Notice settings | dashboard setting for the notice link and the controller's privacy email, replacing the environment variable; link in invoice emails; EN and ES guide page with §4.1's templates | yes (a settings row) | no: the email body is not the invoice | `venue.configure` | setting round-trip; the link in invitation, invoice email, login and profile; an empty setting shows nothing | none |
| **S2** Staff export | §4.2's ZIP | no | no | O5 | a fixture with a distinct value in every table that names the person, each asserted present; no hash string present (negative control: put one in and see it fail) | O5 |
| **S3** Customer by NIF | search sales by recipient NIF; export §4.2 | maybe (an index on `sales`) | no: reads only | O5 | sole-trader fixture; `es 12345678z`, `ES12345678Z` and `12345678 Z` all find it; a company NIF is found too; nothing from other customers | O5 |
| **S4** Wipe at deactivation | delete §5.2 item 1's secrets on both deactivation routes, reusing reset login's statements; `suspendPerson` (`packages/identity/src/staff.ts:538-551`), which no route calls, the package index does not export and only its tests use, is deleted or made to wipe too, so a later route cannot bypass the wipe. **Auth change: a risk trigger, full review** | no | no | `person.manage` | each secret gone after _Deactivate_ and after the edit route; time entries untouched; re-inviting still works; sign-in refused | **O2** |
| **S5** Requests register | received, kind, person, one-month due date (R9), answer, restriction note (R26); exports logged here | yes | no | O5 | due date at one month; overdue shown; restriction visible | **O7** |
| **S6** Record and breach material | per O10: a dashboard page, or guide templates; never a risk verdict | no | no | O5 | per O10 | **O10** |
| **S7** Bucket check | after setup, read the bucket's default encryption and region; show "encrypted", "not encrypted" or "unknown" (when the provider does not answer or the keys may not ask), and "EU", "outside the EU" or "unknown"; warn, never block | no | no | `system.manage` | an S3 test server answering each way, and refusing the question | **O8** |
| **S8** Allergy hint | the "who" field's placeholder says "seat or description, not a name" | no | no | none | EN and ES strings | **O6** |
| **S9** Booking and allergy erasure on request | §4.3(c) | no | no | O5 | each field cleared; allergy text moved before notes are cleared; allergy evidence kept | **G3** |
| **S10** Log check | probe whether any logged error detail carries a name or email: an email-server refusal, and error parameters such as `person.email_taken` and `person.display_name_taken` (`packages/identity/src/staff.ts:53-66`); mask it if so | no | no | none | a failing probe first | none |
| **S11** Former employee's contact clearing | O1(c): clear email and phone a year after deactivation; needs a stored date and a review list; `suspendPerson` (`staff.ts:538-551`, unrouted, used only by tests) is deleted or made to set the date too, as in S4 | yes | no | O5 | the date set by both routes; cleared only after the year | **O1, G2, G3** |

The bug-report design (backlog A9) carries O9's rules into its own slices. O4's option (b) would
be a fiscal slice and is not proposed.

---

## 6. How A664 folds in

| A664 already decides (adopted for specialist review, 2026-10-17) | A980 adds | Still gated by A664 |
| --- | --- | --- |
| C-LIVE, the shared six-year discussion baseline; its policy rows; holds; the archive contract; copies and restore rules; the field audit | the map by person rather than by table; controller and processor roles; notices; access, export, correction and erasure handling; breach; the record; DPO; monitoring | every retention sweep, archive and timed expiry (G1 to G3); actual copy expiry (G4); any change to append-only rows (G5) |

Nothing proposed here deletes evidence or runs on a timer before the specialists agree. S4 is not
a retention rule: it is security behaviour (R19) that the product already performs, ungated, when
a manager resets a login or re-invites a suspended person (`packages/identity/src/staff.ts:303-318`,
`:322-357`), extended to the moment of deactivation. O2 asks you whether to build it on that basis,
and Q55(b) lets the privacy specialist object. S9, S11 and §5.2 item 3 wait for G3. Q48 already
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
| support access | owner, 2026-10-21: only with the venue's approval each time, time-limited, logged and visible to the venue; an emergency override logged and reported. §4.5's breach material reads the same log |
| the relay (Q57) | §2.4 r10: whether carrying encrypted bytes makes Waitron a processor |
| breach duty, processor to controller "sin dilación indebida" (R20, paragraph 2) | a Cloud alert into the venue's breach material (S6) |
| bug reports (O9, Q57) | what a report may carry, and whether Waitron is processor or controller for it |
| sub-processors | AWS; owner, 2026-10-21: the translation model receives menu text only (§2.4 r9) |
| requests Cloud receives | forwarded to the venue, which answers as controller |

---

## 8. Questions for the owner

Each is one decision, with a recommended default.

**O1. A former employee's email after they leave.** Marta leaves on 30 September 2026 and her
account is deactivated. Your decision of 2026-10-21 (go-live walkthrough) keeps an email on every
**active** account; hers is no longer active.

- **(a) Keep it with no end date.** This is today's behaviour: nothing ever removes it. The venue
  can always reach her, but holds her address for years with little reason.
- **(b) Clear it at deactivation.** Least data. If she asks for her time record in March, the
  manager has to ask her for an address; a re-hire gets a new email typed in.
- **(c) Keep it for one year after she leaves, then clear it, keeping her name.** One year is the
  limit the Workers' Statute sets for contract claims that have no special period of their own,
  so it is when the venue is likeliest to need to write to her. A re-hire within the year reuses
  her account and address.

**Recommended: (c).** It needs its own small change, which stores the date and clears the address
a year later; that change waits until the labour and privacy specialists agree.

**O2. Delete sign-in details when someone is deactivated.** A manager deactivates Marta on
30 September. With **yes**, her PIN, password, two-factor codes, Google link and passkeys are
deleted in the same step. The product already deletes these, and the recovery codes and pending
passkey challenges besides, when a manager resets
someone's login or re-invites a person who had been deactivated, so this only does the same thing
one step earlier, as a security measure. With **no**, they stay, as today, and keep being copied
to the backup storage. **Recommended: yes.** No working-time record or other evidence is touched,
the details are useless once she cannot sign in, and the privacy specialist is told and can object.

**O3. Where the full privacy notice lives.** A customer reads the short line and wants the
details. The box cannot serve the page itself today. Without remote access, customers outside the
restaurant cannot reach it; with it, public HTTPS ends at Waitron's gateway, which forwards only
an allowlist of paths, and the only public endpoint so far is `GET /public/availability`, which
answers whether the venue is available. Menus, bookings and the customer-facing remote setup
screen "remain separate work" (`docs/developers/cloud-connection.md:165-170`). **(a) The venue's own web page**, its address entered in a dashboard setting.
**(b) Later, a page Waitron Cloud hosts for each Cloud-connected venue** from the venue's own
text. **Recommended: (a) now, (b) later** through lane D.

**O4. A privacy line on printed receipts.** **(a) No code:** the venue types a short privacy line
into the existing receipt footer, which prints on every receipt; the help guide supplies the
wording. **(b) A dedicated line printed only on full invoices,** which changes what an invoice
prints and so is a tax change. **Recommended: (a).**

**O5. Who may download or erase a person's data.** A shift manager is asked by a customer for "all
my data". **(a) A new permission for data requests, held only by admins; giving it to another role later is
a code change** (each role's permissions are fixed in code, `packages/identity/src/permissions.ts:46-80`). **(b) The existing staff-management permission**, which managers hold. **(c) The
existing report-export permission.** **Recommended: (a).** A staff download holds pay rates and
sick-leave notes, and a separate permission makes it clear who handled each request.

**O6. Steer allergy notes away from names.** A waiter types "Ana García: cacahuete". **Yes:** the
field's hint reads "seat or description, not a name", so the note says "window, seat 2:
cacahuete". **No:** unchanged. **Recommended: yes.** The kitchen needs the seat, not the name, and
later erasure requests rarely have to touch the kitchen's copies.

**O7. A requests list in the dashboard.** Jordi emails on 5 November; the venue must answer by
5 December and must be able to prove it did. **Yes:** a small list of requests with due dates and
answers. **No:** the venue keeps its own spreadsheet. **Recommended: yes.**

**O8. Warn about backup storage outside the EU or of unknown encryption.** The owner sets up
backups with a provider whose storage is in the United States, or whose service does not answer
when asked whether it encrypts. **Warn:** the Backups page says "region: outside the EU" or
"encryption: unknown" and links the guide; backups still run. **Block:** backups refuse to start.
**Nothing:** as today. **Recommended: warn.** Blocking would leave the venue with no copy at all.

**O9. What a bug report may carry.** The planned "Report a problem" button and automatic crash
reports will send information to Waitron. A manager's till freezes and an automatic report is
offered. **(a) Automatic reports carry only the error, the Waitron version and log lines with
personal details masked; anything a person typed travels only in a report the manager has read and
chosen to send.** **(b) Everything in the bundle, always.** **Recommended: (a).** It keeps the
personal data Waitron receives to a minimum and matches your 2026-09-24 decision that the public
issue carries only the stack, the Waitron version and the error code (`docs/backlog/alerts.md:41-43`).

**O10. The record of processing and the breach checklist: a dashboard page, or templates in the
help guide?** The venue's adviser is drafting the written record and a breach plan.
**(a) A dashboard page** that fills a draft record from the venue's details and enabled features,
and walks a manager through a breach's questions. **(b) Templates in the help guide**, in English
and Spanish, listing the activities from this map and the AEPD's breach questions, which the
adviser fills in. Neither gives a verdict on whether to notify. **Recommended: (b) for go-live.**
It costs a fraction of (a), and filling in the record and judging a breach is the adviser's work.

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
`waitron.log` (S10); whether old objects actually leave a provider's bucket (A664 G4); the claim
check's Vitest probe of deactivation (§5.2 item 1), which I did not re-run.
