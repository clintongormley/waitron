# A795 — installing or renewing the AEAT certificate after setup — design

Date: 2026-10-18. Status: **waiting on the owner's answers to three questions (§9)**. Nothing is
built. Fiscal-adjacent, so the build takes the FULL review path and the owner lands it.

Backlog entry: `docs/backlog.md` → _Fiscal records, invoices and the asesor_ → "Installing or
renewing the AEAT certificate after setup"; detail in `docs/backlog/fiscal.md`.

**The decision in one paragraph.** A new card, "AEAT certificate", on Venue settings → Venue details,
beside the Business card that holds the legal name and tax ID. Anyone who may see fiscal alerts sees
the card: who the certificate belongs to, its tax ID, its type, who issued it, when it is valid, how
many days are left, who installed it and when, and when AEAT last accepted a record. "Replace
certificate" opens a dialog that takes the file, its passphrase and its type. Before anything is
replaced the box opens the file, checks the passphrase, the private key, the dates and the tax ID,
then asks AEAT a read-only question with the new certificate. Only if all of that passes does the new
certificate replace the old one, in one short database write. Sales never wait for any of it, filing
picks up the new certificate on its next pass without a restart, and every install is recorded. An
alert warns as expiry nears and a separate one says when it has passed.

---

## 1. Words used

- **AEAT** — the Agencia Tributaria, Spain's tax agency. Waitron files every invoice record with it.
- **The certificate** — the qualified electronic certificate the box presents to AEAT when it files.
  It arrives as one file (`.pfx` or `.p12`, the "PKCS#12" format) holding the certificate and its
  private key, locked with a passphrase chosen when the file was exported.
- **FNMT** — the Fábrica Nacional de Moneda y Timbre, the Spanish body that issues these certificates.
- **Certificate type** — Waitron knows two: a **company seal** (_sello de entidad_), which belongs to
  the company, and a **representative** certificate (_representante_), issued to a named person acting
  for the company. The type decides which AEAT address the box talks to.
- **The taxpayer** — the business whose invoices are filed: the one row in the `tenants` table. Its
  **tax ID** (_NIF_) is `tenants.tax_id` (`packages/db/src/schema/tenants.ts:36-45`).
- **Filing pass** — one run of the loop that sends waiting invoice records to AEAT (`drain` in
  `packages/fiscal-verifactu/src/drain.ts`). It runs in the background; a sale never waits for it.
- **The vault** — the `tenant_credentials` table, where the box keeps secrets encrypted under a key
  only this box holds (`packages/credentials/src/store.ts`). The certificate is the vault entry named
  `fiscal.aeat`.
- **Live check** — a question the box asks AEAT with the new certificate before installing it: a
  _consulta_, AEAT's "show me records already filed" service. It files nothing.
- **Days left** — whole calendar days, in the venue's time zone, from today to the day the
  certificate expires (§5.4).

---

## 2. What happens today

Every statement here says whether it was **measured** (a command was run; the output is quoted) or
**read** (the code was read, nothing run). The probes are in §2.8; the scratch test files were
deleted after the run.

### 2.1 Only setup can install the certificate

- The setup wizard's certificate screen asks for the file, the passphrase and the type
  (`apps/setup/src/screens/cert-screen.ts:283-372`). Its own checks are only "a file was chosen" and
  "the passphrase is not empty" (`cert-screen.ts:250-257`). **Read.**
- The server's check, `parseAeatCert` → `validateAeatCert`
  (`packages/fiscal-verifactu/src/provisioning-secret.ts:25-69`), checks only the type's spelling,
  that the file is valid base64 text, and that the passphrase is not empty. It never opens the file.
  **Measured** (P1): a wrong passphrase, 600 random bytes named `.p12`, a file with no private key and
  an expired certificate were all accepted.
- `sealAeatSecret` writes the vault entry `fiscal.aeat` = `{ pfxBase64, passphrase, certKind }`
  (`provisioning-secret.ts:76-92`) through `putCredential`, which overwrites any earlier entry
  (`packages/credentials/src/store.ts:96-124`). The vault keeps exactly one entry per name
  (`packages/credentials/src/schema/tenant-credentials.ts:29-30`), so there is no history. **Read.**
- A production setup also requires an accepted test submission to AEAT's test environment with the
  same certificate (`apps/server/src/setup-api.ts:757-763`, `apps/server/src/fiscal-readiness.ts`,
  `apps/server/src/fiscal-readiness-runner.ts:82-186`). That check exists only in the setup branch of
  the server (`apps/server/src/boot.ts:1087-1130`). **Read.**
- **Setup never compares the certificate's tax ID with the taxpayer's** — it never opens the file
  (P1). AEAT does: error 4112, "El titular del certificado debe ser Obligado Emisión, Colaborador
  Social, Apoderado o Sucesor" (quoted in `docs/compliance/getting-to-production.md`, "Who the
  certificate holder must be"). **Read.**
- There is no route to install or replace the certificate after setup. The command-line tool
  `waitron-credentials set` can write any vault entry (`packages/credentials/src/cli.ts:29-56`), but
  the box image does not ship it: the image copies only the server's own commands
  (`deploy/Dockerfile:196-204`; `apps/server/package.json` `waitron.commands`). **Read.**
- The `fiscal.awaiting_certificate` alert tells the reader to "Upload the certificate to resume
  submitting" (`apps/dashboard/src/i18n/alert-messages.ts:202-205`), but nothing in the product can
  upload one after setup. **Read.**

### 2.2 How filing uses the certificate

- Each filing pass builds a fresh connection helper (`packages/fiscal-verifactu/src/slot.ts:62-78`).
  It reads the vault only when there is work to send (`drain.ts:149-156`), at most once per pass
  (`aeat-transport.ts:140-150`), and opens a new mutual-TLS connection pool with that certificate
  (`mtlsFetch`, `aeat-transport.ts:101-117`), closed when the pass ends. **Measured** (P4): after
  writing certificate A and asking the helper for a connection, then writing certificate B and asking
  again, the second request used B's exact bytes (`same-bytes-as-othernif=true`). So a new
  certificate is used from the next pass that has work; no restart.
- The certificate type picks the AEAT address: a seal goes to `www10` (`prewww10` in the test
  environment), a representative certificate to `www1` (`prewww1`) (`aeatEndpointFor`,
  `aeat-transport.ts:77-82`). **Read.**

### 2.3 What a pass does with a missing, broken or expired certificate

- **Missing** (no vault entry): the pass records a skip with `credentials.missing`
  (`drain.ts:154-161`), which sets the "awaiting certificate" flag (`apps/server/src/pass.ts:76-89`)
  and raises the `fiscal.awaiting_certificate` alert (`apps/server/src/alert-sources.ts:303-323`).
  **Measured** (P5, control): `skipped=[{"errorCode":"credentials.missing"}]`.
- **Expired** (or not yet valid): the box does not refuse to use it. It presents the certificate,
  and it is the server at the other end that decides. **Measured** (P3): against a local server that
  checks client certificates, the expired and the not-yet-valid certificate both failed with
  `UND_ERR_SOCKET other side closed`; against the same server with checking switched off, both were
  answered `HTTP 200` — so the box sent them. That AEAT refuses an expired certificate the same way is
  **assumed, not measured**: no expired real certificate was available.
- Through the real filing pass, an expired certificate is treated as a **network failure, not as a
  missing certificate**. **Measured** (P5): `skipped=[] batchesSent=0`, the record stayed `pendiente`
  with `intentos: 1` and its next try pushed one minute later (`2026-10-18T10:01:00.000Z` after a
  pass at 10:00). So `fiscal.awaiting_certificate` is **not** raised for an expired certificate. What
  does fire, after four hours, is `fiscal.submission_delayed` (warning at 4 h, error at 24 h:
  `packages/fiscal-verifactu/src/submission-alerts.ts:12-13`), whose text says "check that the fiscal
  certificate is valid". The retry wait doubles from one minute to a ceiling of one hour
  (`drain.ts:64-80`). **Measured**: the existing test "backs off a transiently-failed batch
  exponentially, capped at 3600s, marking incidencia" passed (`Tests 1 passed | 50 skipped`); it
  asserts the failed record is marked as sent late (`incidencia`).
- **Wrong passphrase**: the same — the failure surfaces only when the connection opens. **Measured**
  (P3): building the connection helper succeeded; the request failed with `mac verify failure`.
- This contradicts a prediction in `docs/compliance/first-aeat-contact.md` (2026-07-28) that an expired
  certificate "would first appear as a drain pass that skips its due work". A dated pointer to this
  section is added there in the same change.

### 2.4 Nothing watches the expiry date

- `apps/server/src/cert-expiry.ts` reads the box's own HTTPS certificate (the one tills and browsers
  see), not the AEAT one; its only caller is the box-status route (`apps/server/src/box-status.ts:128`),
  which needs `system.manage`. **Read.**
- Its "days remaining" is whole 24-hour periods rounded down (`cert-expiry.ts:16`). **Measured** (P7):
  for a certificate expiring at 01:30 Madrid time on 25 Oct 2026, read at 10:00 on 24 Oct, it answers
  `daysRemaining 0` — although the certificate is good until tomorrow. The new count (§5.4) uses
  calendar days instead.

### 2.5 Who can see and change fiscal things today

- Roles are staff → supervisor → manager → admin; admin holds every permission
  (`packages/identity/src/permissions.ts:43-83`). Managers hold `fiscal.view` and `system.manage`
  (`permissions.ts:56-75`). **Read.**
- The secrets the box keeps after setup are changed by managers: the email server under
  `system.manage` (`apps/server/src/email-settings-api.ts:85,134`), the backup bucket under
  `system.manage` (`apps/server/src/backup-api.ts:290`), the card provider's key under
  `payments.manage`, which first asks the provider whether the key works and only then saves it
  (`apps/server/src/payments-api.ts:611-639`). The legal name that goes on every filed record is
  changed under `venue.configure` (`apps/server/src/location-settings-api.ts:263-296`). **Read.**
- The reverted design of 2026-09-07 (`docs/superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md`
  §3.3, §6.2) planned an install route behind a new admin-only permission, `fiscal.configure`. It
  landed as #279 and was reverted by #281 (`git show a599e3353`); the permission is not in
  `permissions.ts` today. On 2026-09-26 the owner said the permission list is too fine-grained and new
  work should reuse what exists (Q1 turns on this).

### 2.6 Standby, cloud and restore

- Today a venue has one node and no failover (CLAUDE.md §5); the replication the 2026-09-07 design was
  built on was removed on 2026-09-19 (`docs/backlog/replication-cloud.md`, "Getting the AEAT
  certificate onto a promoted standby needs a new design"). **Read.**
- The vault table is `local`: an entry is sealed under the key of the node that wrote it, and only
  that node opens it (`packages/credentials/src/classification.ts`). A recovery bundle carries that
  key (`secrets.env`, `apps/server/src/state-secrets.ts:10-22`), so a restored box opens the restored
  entry. **Read.**

### 2.7 Who may hold the certificate

From sources already in the repo, quoted:

- SWeb §4.1 (in `docs/compliance/research/2026-10-09-operations.md`, §4.6): «La remisión a través del
  servicio web podrá ser efectuada por el obligado tributario, un apoderado suyo a este trámite o un
  colaborador social». In English: the taxpayer, someone with a registered power of attorney for this
  procedure, or a "social collaborator" (typically an accountancy firm) may send.
- The same file: the published authorisation forms cover only sending, «sin que confiera al remisor
  la condición de representante del otorgante para intervenir en otros actos». Whether such a third
  party may also make AEAT queries for the taxpayer is open (asesor question Q30,
  `docs/compliance/asesor-questions.md`).
- `docs/compliance/getting-to-production.md` §1 calls avoiding third-party submission "the recommended
  architecture".
- The tax ID inside a representative certificate is the company's, in the subject's
  `organizationIdentifier` as `VATES-<NIF>`; the subject's `serialNumber` is the person's own ID
  (`docs/compliance/first-aeat-contact.md`, "The certificate" and point 2). Where a company seal
  carries the company's tax ID is **not** recorded in the repo — an item for the build to check
  against a real seal (§8).

### 2.8 The probes

Run 2026-10-18 on Node v26.11.1 in this worktree. Test certificates were made with OpenSSL 4.0.3 by
`/Users/clintongormley/waitron-campaign/a795-probes/make-fixtures.sh`: a private test authority, and
certificates for "PROBE DELI SL" (`organizationIdentifier=VATES-B12345678`, valid 1 Jan 2026 – 3 Oct
2027), an expired one (to 1 Oct 2026), a not-yet-valid one (from 1 Jan 2027), one for another company
(`VATES-B87654321`), a file without a private key, and 600 random bytes. The vitest probes were scratch
files under `packages/fiscal-verifactu/src/`, deleted after the run.

| Probe | What a failing case would print | What it printed |
| --- | --- | --- |
| P1 `parseAeatCert` on four bad files | `threw setup.request_invalid …` for any of them | all four `accepted` |
| P2 Node's own `tls.createSecureContext({ pfx, passphrase })` | `accepted` for the wrong passphrase | right passphrase `accepted`; wrong passphrase `threw … mac verify failure`; random bytes `threw … wrong tag`; no key `threw ERR_CRYPTO_OPERATION_FAILED … Unable to load private key from PFX data`; expired `accepted` |
| P3 `mtlsFetch` against a local server that checks client certificates, and again with checking off | an expired certificate refused by the box itself, before sending | checking on: valid `HTTP 200`; expired and not-yet-valid `fetch rejected … other side closed`; wrong passphrase `fetch rejected … mac verify failure`. Checking off: valid, expired and not-yet-valid all `HTTP 200`; wrong passphrase still `mac verify failure` |
| P4 the filing pass's helper, certificate written twice | `same-bytes-as-othernif=false` (a cached certificate) | first read `representante`; second read `sello`, `same-bytes-as-othernif=true` |
| P5 a real filing pass, expired certificate installed; then the control with none | `skipped=[{"errorCode":"credentials.missing"}]` for the expired one | expired: `skipped=[] batchesSent=0 row={"estado":"pendiente","intentos":1,"proximo_intento_en":"2026-10-18T10:01:00.000Z"}`; none: `skipped=[{"errorCode":"credentials.missing"}]` |
| P6 read the certificate's details from the file with Node's own documented API (`new TLSSocket(null, { secureContext }).getCertificate()`), no network | `null` | `12345678Z ANA GARCIA (R: B12345678) valid_to=Oct  3 00:00:00 2027 GMT raw=926 bytes` |
| P7 today's `readCertExpiry` the morning before a 01:30 expiry | `daysRemaining 1` | `daysRemaining 0` |

P6 also tried the undocumented `createSecureContext(...).context.getCertificate()`; it worked, but the
build uses the documented route. P6 and P7 were plain scripts in
`/Users/clintongormley/waitron-campaign/a795-probes/`.

---

## 3. The new model

### 3.1 Where it lives

A card, **AEAT certificate**, on **Venue settings → Venue details**, directly after the Business card
(legal name, tax ID, country). The certificate has to match that tax ID, so it sits beside it — the
same reasoning that put "Change legal name" on the Business card (`legal-name-dialog.ts`).

The card is contributed by the Veri*Factu module, not by the dashboard: a venue on the no-fiscal
module (`fiscal-none`) has no certificate and no card, and generic code never learns what a PKCS#12
file is (CLAUDE.md §3, "A new product domain lands as a MODULE"). Venue settings already takes module
panels on its tabs (`apps/dashboard/src/dashboard-app.ts:1904-1920`).

### 3.2 Who may see it, who may change it

- **See**: anyone holding `fiscal.view` — managers and admins (`permissions.ts:56-82`), the same
  people who see the fiscal alerts the card answers.
- **Change**: **Q1** (§9). The recommended default is `system.manage` (managers and admins),
  following the email, backup and card-provider secrets (§2.5); the alternative is an admin-only
  `fiscal.configure`.
- Only the node that files may change it. Today that is the only node; a read-only mirror already
  refuses every write (`read-only-gate.ts`).

### 3.3 What the card shows

All of it comes from the install record (§3.7) and the filing tables; showing the card decrypts
nothing.

| Row | Example | Source |
| --- | --- | --- |
| Holder | 12345678Z ANA GARCÍA (R: B12345678) | the certificate subject's common name |
| Tax ID | B12345678 · matches the business | §3.5's tax-ID rule |
| Type | Representative (representante) | the type chosen at install |
| Issued by | AC Representación (FNMT-RCM) | issuer common name and organisation |
| Valid from | 3 Oct 2025 | `notBefore`, venue time zone |
| Valid until | 3 Oct 2027 · 350 days left | `notAfter`; §5.4 |
| Installed | 14 Nov 2025, 10:12 · during setup / · Marta Soler | install record |
| Last accepted filing | Today, 13:02 / None since it was installed | latest `envios.confirmado_en` with `estado` accepted, at or after the install (`packages/fiscal-verifactu/src/schema/envios.ts:24-37`) |

A status line above the rows appears from the warning threshold on (§3.8): amber while it is a
warning, red from 14 days and after expiry, green just after a successful install.

On a box that does not send records — demo or preparation, or preproduction without test
submissions (`fiscalDrainEnabled`, `apps/server/src/onboarding-policy.ts:12-16`) — the card says
"This box does not send records to AEAT, so it needs no certificate" and offers no button. With no
certificate installed on a box that files, it says "No certificate installed. Fiscal records wait
until one is." and the button reads "Install certificate".

There is no "Remove certificate": removing it would only stop filing.

### 3.4 Installing or replacing — the dialog

"Replace certificate" opens a dialog with the setup wizard's three fields, marked required: the file
(`.pfx` or `.p12`), the passphrase (with Show/Hide) and the type, pre-set to the current certificate's
type. The button says **Save** (design-system.md → Forms). It is quiet and disabled until a file and a
passphrase are given, follows the house form rules (errors beside the field, one sentence at the
bottom above the buttons, a refusal from the server never disables Save), and takes a draft scope
with an unsaved-changes test (CLAUDE.md §3). While the server works, Save reads "Checking with
AEAT…".

### 3.5 What is checked before the new certificate replaces the old

In this order; the first failure answers, nothing is written, the current certificate is untouched.

1. **Size.** A file over 100 KB is refused (a real one is about 3.5 KB; the probe files were 3,579
   bytes). The route takes a body limit, as `apps/server/src/cloud-api.ts` does.
2. **It opens.** `tls.createSecureContext({ pfx, passphrase })` (P2): a wrong passphrase, a file that
   is not PKCS#12 and a file without a private key are each told apart by the error Node raises.
3. **Its details read.** `new TLSSocket(null, { secureContext }).getCertificate()` then
   `X509Certificate` (P6): subject, issuer, `notBefore`, `notAfter`, and the SHA-256 fingerprint of
   the certificate itself.
4. **Dates.** Refused if `notAfter` has passed or `notBefore` has not arrived, by the box's clock.
5. **Not the same one.** Refused if its fingerprint is the installed one's (the legal-name precedent,
   `location-settings-api.ts:286`).
6. **Tax ID.** Read from the subject's `organizationIdentifier` (`VATES-<NIF>`); if there is none,
   from `serialNumber` (`IDCES-<NIF>`, which is the holder's own ID — right for a self-employed owner
   filing under their own NIF). Compared with `tenants.tax_id`, ignoring case, spaces and hyphens. A
   readable tax ID that differs is **refused**. A certificate with no readable tax ID goes on to the
   live check, and the card shows "Tax ID: not shown on the certificate".
   - Why refuse rather than allow with a warning: §2.7 — a third party's certificate is legal only
     with a registered power of attorney or a social-collaborator agreement the box cannot see; the
     compliance research calls avoiding it the recommended architecture; and whether such a
     certificate may even make the live check's query is open (asesor Q30). The day Waitron supports
     an accountant's certificate, that is its own design.
7. **Live check with AEAT.** A _consulta_ for the taxpayer (`ObligadoEmision` = legal name and tax
   ID) for the current month, sent with the new certificate to the address for this box's environment
   and the chosen type (`aeatEndpointFor(config.environment)(certKind)`): a production box asks
   production AEAT, a preproduction box asks the test environment. Any well-formed answer passes,
   including "no records" (_SinDatos_). Anything else refuses: a refused connection, an AEAT error, a
   timeout (30 seconds). It files nothing (`apps/server/src/aeat.preprod.test.ts` uses the same call
   for that reason).
   - Receipt that a consulta can prove a certificate: a representative certificate's consulta against
     the test environment answered `SinDatos` on 2026-07-28 (`docs/compliance/first-aeat-contact.md`).
     **Not yet shown**: a consulta to production, and a consulta with a company seal at `www10`. The
     build runs both with a real certificate before landing (§8).
   - A wrong type is caught here: a seal sent to the representative address is rejected
     (`getting-to-production.md`, "Operational trap").
   - It runs outside any database transaction, like the card-provider check
     (`payments-api.ts:617-629`), so no write — and no sale — waits for AEAT.
   - **No override.** If AEAT cannot be reached, the dialog says so and nothing changes. Waiting costs
     nothing: the current certificate keeps filing, or, if it has expired, records keep waiting
     exactly as they would have. Precedent: the card-provider key and setup's production test both
     need the other side's answer.

Then, in **one short transaction**: check that the vault entry is still the one the dialog started from
(`credentialRevision`, `store.ts:131-150`; refused as `fiscal.certificate_changed` if someone else
installed one meanwhile), write the vault entry with `putCredential` (unchanged), and write the install
record (§3.7). The log gets `fiscal.certificate_installed` with the fingerprint and dates, never the
file or passphrase.

The passphrase and the file never appear in a log line, an error's parameters or a response, the rule
`provisioning-secret.ts:24` states for setup.

### 3.6 What happens to filing while it changes

- **No sale waits for AEAT.** The live check holds no transaction. The final write is one short
  transaction like any other; a sale may wait for it as it waits for any write, never for the network.
- **A pass already running finishes with the certificate it read** (P4: one read per pass). If the old
  one still works, its records are accepted as usual; if the old one had expired, that attempt fails
  and those records retry one minute later or more (P5, `drain.ts:64-80`), by then with the new one.
- **The next pass with work uses the new certificate.** No restart.
- **Records that backed off while the old one was failing** wait for their own retry time, at most an
  hour (`BACKOFF_MAX_MS`, `drain.ts:66`). The build does not bring them forward: that would mean writing
  to the filing queue (`envios`), which this design leaves alone. An hour is inside the hourly retry
  duty art. 16.4 sets (`drain.ts:65-66` cites it).
- The "awaiting certificate" flag clears on the next pass with work (`pass.ts:85-89`), unchanged.

### 3.7 The old certificate, and the record of installs

- **The old certificate is not kept.** The live check runs before anything is replaced, so the reasons
  to go back are mostly gone; a second private key on the box is a second thing to protect; and the
  owner still has the old file (FNMT lets two certificates of one kind be live together:
  `getting-to-production.md`, "There is no renewal, but you can overlap"). Going back means uploading
  the old file again, through the same checks.
- **Every install is recorded** in a new table, `fiscal_certificate_installs`, in the Veri*Factu
  module's own migration set: when, who (a plain person id; empty for setup), how (`setup` or
  `dashboard`), the type, fingerprint, holder, tax ID read, issuer, valid from and until, and which
  AEAT address answered the live check. No file, no key, no passphrase.
  - Declared `appendOnly()` — an audit record is never corrected — and classed `local` with a
    `node_id` column every read and write names, because the certificate it describes is sealed under
    this node's key (CLAUDE.md §3, "A `local` table says what ties a row to its node"). It travels in
    the module's migration descriptor and `packages/migrations/migrations.manifest.json` (CLAUDE.md §3).
  - Setup writes one too: the regime's `provisioningSecret.seal` seat writes the vault entry and the
    install record in one transaction. Setup repeats that step when it resumes
    (`setup-api.ts:805-806`), so the record is written only when the latest one's fingerprint differs.
  - The card, the expiry alert and the "same certificate" check read the latest row; none of them
    decrypts the vault. The ongoing-alert interface has no key ring anyway
    (`packages/module/src/alerts.ts:35-42`).
  - A box set up before this ships has a certificate and no install row. Until a venue is live, such a
    box is reset or has its certificate installed again through the card; there is no migration code
    (CLAUDE.md §3, "No backwards-compatibility or data-migration code until Waitron is in production").
    The card shows "Installed: not recorded" with the button, and the expiry alert cannot see that
    certificate's date until it is reinstalled.

### 3.8 The expiry warning

Two new ongoing alerts, area `fiscal`, permission `fiscal.view`, from a new source in the Veri*Factu
module's alerts (`packages/fiscal-verifactu/src/alerts.ts`), beside `fiscalSubmissionSource`. Names
follow the siblings `fiscal.awaiting_certificate` and `fiscal.certificate_available`:

| Code | When | Severity | Params |
| --- | --- | --- | --- |
| `fiscal.certificate_expiring` | from the warning start (**Q2**: 60 days recommended) until 15 days left | warning | `days`, `date` |
| `fiscal.certificate_expiring` | 14 days left to the last day | error | `days`, `date` |
| `fiscal.certificate_expired` | after `notAfter` | error | `date` |

Both link to Venue settings (the `screen` field ongoing alerts already carry, as backup's do,
`alert-sources.ts:74-77`). `since` is the moment the threshold was crossed, so the alert's age reads
true. The 14-day line is not asked: it is the point where a seal can no longer be got in time
(asesor Q10 says weeks; `docs/compliance/asesor-questions.md`, Q10), so it turns red.

Changes to existing alerts:

- `fiscal.awaiting_certificate` gets the same link and new wording (§7), since "Upload the certificate"
  now has somewhere to point.
- `fiscal.submission_delayed` is unchanged; while the certificate has expired both show, and the
  expired one names the cause.

Whether the box also **emails** as expiry nears is **Q3**.

---

## 4. Worked examples

Bar Lucía S.L., tax ID B12345678, Europe/Madrid. Marta Soler is the administrator; Jordi is a
manager. Today is Sunday 18 October 2026.

**E1 — renewing two weeks before expiry.** The certificate on the box runs to 1 Nov 2026, 00:59. Since
11 Oct the card and the alert are red: "expires in 14 days" (mockup 03). Marta gets the new
representative certificate (valid 18 Oct 2026 – 18 Oct 2028), exports `bar-lucia-2026.p12` with a
passphrase, and on the card presses Replace certificate (mockup 04). She chooses the file, types the
passphrase, leaves the type on Representative and presses Save; it reads "Checking with AEAT…"
(mockup 06). The box opens the file, reads B12345678 in the subject, sees it is valid, asks AEAT
production for October's records and gets _SinDatos_ in under a second, then saves. The card turns
green: "Installed. AEAT answered a check with this certificate at 13:05. The next filing uses it."
(mockup 11). The red alert goes the next time the alerts are read; an open dashboard reads them every
minute (`alert-messages.ts` header). The pass at 13:06 sends with the new certificate.

**E2 — a wrong passphrase.** Marta mistypes it. The file does not open (`mac verify failure`, P2);
nothing is sent to AEAT. Under the passphrase: "This passphrase does not open the file."; at the
bottom: "Correct the highlighted fields to continue." (mockup 07). Save stays enabled; she fixes it and
saves.

**E3 — a certificate for another tax ID.** Marta also runs Lucía Catering S.L. (B87654321) and picks
that company's file by mistake. Under the file: "This certificate is for tax ID B87654321, not
B12345678." (mockup 08). Nothing reaches AEAT.

**E4 — an expired file.** She picks last cycle's `bar-lucia-2024.p12`, which expired on 1 Oct 2026.
Under the file: "This certificate expired on 1 Oct 2026." (mockup 09).

**E5 — the wrong type.** She uploads a company seal but leaves the type on Representative. Every local
check passes; the consulta goes to `www1`, which rejects a seal. At the bottom: "AEAT did not answer a
check with this certificate. The current certificate is unchanged. Check the certificate type, then
try again." (mockup 10). She picks Company seal and saves.

**E6 — replacing while a pass is sending.** At 13:02:10 a pass reads the old certificate and sends
twelve records. At 13:02:11 Jordi's Save passes its live check and commits. The twelve records finish
with the old certificate and are accepted. The pass at 13:03 reads the new one. If the old certificate
had already expired, the 13:02:10 send fails, the twelve wait one minute (P5), and go at 13:03 with the
new one, marked as sent late.

**E7 — it expires while the owner is away.** The certificate runs to 25 Oct 2026, 00:59, and Marta is
away from 17 Oct to 2 Nov, opening the dashboard only now and then.
- 26 Aug: amber warning, "expires on 25 Oct 2026, in 60 day(s)" (mockup 12; with Q2's default).
- 11 Oct: red, 14 days (mockup 13). With Q3's default an email has gone out at each step.
- 25 Oct, 00:59: it expires. Sales go on; every invoice is chained and queued as always. Each pass's
  send fails at the connection (assumed for AEAT; P3 shows the shape locally), the records wait, and
  the wait doubles to hourly. Alerts: `fiscal.certificate_expired` at once; `fiscal.submission_delayed`
  as a warning four hours after the oldest waiting record and as an error after 24 hours (mockup 14).
  `fiscal.awaiting_certificate` does not appear — the certificate is there, just expired (P5).
- 2 Nov: Marta installs the new one (E1). The waiting records go on their next retry, within the
  hour, up to 1,000 per send, marked as sent late. Whether such a gap counts as a technical incident
  for AEAT was asesor Q10; it was dissolved by treating overlap as the control
  (`asesor-questions.md`, Q10). The expiry warning is that control.

**E8 — "days left" on the evening before.** A certificate expires at 01:30 Madrid time on 25 Oct 2026
(23:30 UTC on the 24th). At 10:00 on 24 Oct today's code would say 0 days (P7). The card says "Expires
tomorrow, 01:30"; at 00:10 on the 25th it says "Expires today, 01:30".

---

## 5. Edge cases

1. **The standby or cloud copy.** None exists today (§2.6). The vault is `local`, so a future standby
   could not open this box's entry anyway; getting the certificate onto a promoted node stays its own
   item (`docs/backlog/replication-cloud.md`). When that design returns it must decide what a renewal
   on the primary does to the standby; the reverted 2026-09-07 design left it deferred (§3.3 there).
2. **A box restored from a backup** gets the vault entry and the install records as they were in the
   backup, and the key to open them (§2.6). A restore from an older archive can bring back a
   certificate that was since replaced, possibly expired; the card and the alerts show it, and the
   owner installs the current one. A restore starts a new invoice chain (CLAUDE.md §5); the certificate
   is not part of that and this design changes nothing there.
3. **Preproduction and production.** The live check goes to the environment the box files to (§3.5
   step 7). A certificate valid for production is accepted by the test environment too (open access to
   any real qualified certificate: `getting-to-production.md` §2). A box that does not send records
   shows no button (§3.3).
4. **Time zone and summer time for "days left".** Days left = the number of calendar days from today's
   date to the expiry date, both taken in the venue's time zone (`locations.time_zone`, default
   Europe/Madrid, `tenants.ts:19,82`). A 23- or 25-hour day at a clock change does not move the count.
   The alert's thresholds are counted the same way; its `date` param is the venue-local date. Alert
   texts have no date slot today, only `{name:money}` (`packages/dashboard-kit/src/alert-messages.ts:4,56`),
   so the build adds `{name:date}`.
5. **The box's clock is wrong.** The date checks and the count trust the box's clock; the clock check
   (`fiscal.clock_drift`) already warns when it disagrees with AEAT.
6. **A self-employed owner's personal certificate.** It routes correctly as "Representative" (both go
   to `www1`), and §3.5's tax-ID rule reads its `serialNumber`. The type list's labels do not name it;
   that is setup's wording too and is left as it is.
7. **Two people saving at once.** The second is refused `fiscal.certificate_changed` (§3.5) and sees the
   first one's certificate when the dialog closes.
8. **A certificate valid for only a few days.** Installed; the red alert shows at once. Not refused: it
   is still better than an expired one.
9. **A certificate written by hand** with the development-only `waitron-credentials` tool leaves no
   install record, so the card would show the previous record. That tool is not in the box image
   (§2.1); the plan states it in the tool's usage text.

---

## 6. What changes, by package and file

Nothing in this list touches `computeHuella`, the chain, invoice numbering, `registros_facturacion`,
`recordSale`, `recordCorrection`, `recordSubstitution`, `registerSif` or `restoreFiscal`, and the
build calls none of them. Existing functions it calls, unchanged: `putCredential`,
`credentialRevision` (`@waitron/credentials`); `mtlsFetch`, `aeatEndpointFor` (`aeat-transport.ts`);
`createClient` and its `consultar` (`@waitron/verifactu`); `authorizeManager`, `withTransaction`. The
filing pass (`drain.ts`), its queue (`envios`) and `pass.ts` are not changed.

| Package | File | Change |
| --- | --- | --- |
| `@waitron/fiscal` | `src/contribution.ts` | an optional `certificate` seat on `FiscalContribution`: read the current summary, check a candidate, install it |
| `@waitron/fiscal-verifactu` | `src/certificate.ts` (new) | open and read a PKCS#12 (§3.5 steps 1–6), the tax-ID rule, the live check, the install transaction, the card's summary query |
| | `src/schema/certificate-installs.ts` (new), its migration, `src/classification.ts` | the install record (§3.7) |
| | `src/slot.ts`, `src/provisioning-secret.ts` | wire the seat; setup's seal also writes the install record, once per fingerprint |
| | `src/certificate-alerts.ts` (new), `src/alerts.ts` | the expiry source (§3.8) |
| | `src/errors.ts` | `fiscal.certificate_invalid` {field, reason}, `fiscal.certificate_check_failed` {reason, codigo?}, `fiscal.certificate_changed`, and the two alert codes |
| | `src/dashboard/` (new) | the card, the dialog, their English and Spanish strings, a11y and unsaved-changes tests |
| `@waitron/dashboard-modules` | `src/index.ts` | register the module's dashboard contribution |
| `@waitron/dashboard-kit` | `src/alert-messages.ts` | a `{name:date}` slot |
| `@waitron/migrations` | `migrations.manifest.json` | the new append-only table |
| `apps/server` | `src/fiscal-certificate-api.ts` (new), `src/boot.ts` | `GET` and `POST /management-api/fiscal-certificate`, body limit, permission checks, HTTP status map; mounted in the trading branch |
| | `src/alert-sources.ts` | `fiscal.awaiting_certificate` gains the Venue settings link |
| `apps/dashboard` | `src/i18n/alert-messages.ts` | wording for the two new codes; new wording for `fiscal.awaiting_certificate` |
| `@waitron/identity` | `src/permissions.ts` | only if Q1 picks the admin-only permission |
| root guards | `scripts/ongoing-alert-codes.test.ts` | add the new source file to its list (that guard reads named files as text) |
| `apps/server` (Q3 only) | a daily reminder and its email, beside `src/account-email.ts`; a `local` table of reminders sent | §9 Q3 |
| docs | `docs/compliance/first-aeat-contact.md` | a dated pointer to §2.3 (added in this change) |

---

## 7. Text, in English and Spanish

As short as the meaning allows. Field labels and type names reuse the setup wizard's strings
(`apps/setup/src/i18n/strings/venue.ts:172-197, 402-429`).

| Key | English | Spanish |
| --- | --- | --- |
| card title | AEAT certificate | Certificado de la AEAT |
| rows | Holder · Tax ID · Type · Issued by · Valid from · Valid until · Installed · Last accepted filing | Titular · NIF · Tipo · Emitido por · Válido desde · Válido hasta · Instalado · Último envío aceptado |
| matches | matches the business | coincide con el negocio |
| no tax ID | not shown on the certificate | no figura en el certificado |
| days | {days} days left · Expires tomorrow, {time} · Expires today, {time} · Expired on {date} | quedan {days} días · Caduca mañana a las {time} · Caduca hoy a las {time} · Caducó el {date} |
| installed by | during setup · {name} · not recorded | durante la configuración · {name} · sin registrar |
| no filing yet | None since it was installed | Ninguno desde que se instaló |
| buttons | Replace certificate · Install certificate | Sustituir certificado · Instalar certificado |
| none installed | No certificate installed. Fiscal records wait until one is. | No hay ningún certificado instalado. Los registros fiscales esperan hasta que lo haya. |
| not filing | This box does not send records to AEAT, so it needs no certificate. | Este equipo no envía registros a la AEAT, así que no necesita certificado. |
| warning line | This certificate expires on {date}. Get the new one from FNMT now: a company seal can take weeks. | Este certificado caduca el {date}. Pide ya el nuevo a la FNMT: un sello de entidad puede tardar semanas. |
| red line | This certificate expires in {days} days. After that, fiscal records wait until a new one is installed. Sales are not affected. | Este certificado caduca dentro de {days} días. Después, los registros fiscales esperan hasta que se instale uno nuevo. Las ventas no se ven afectadas. |
| installed line | Installed. AEAT answered a check with this certificate at {time}. The next filing uses it. | Instalado. La AEAT ha respondido a una comprobación con este certificado a las {time}. El próximo envío lo usa. |
| dialog title | Replace AEAT certificate | Sustituir el certificado de la AEAT |
| dialog intro | Waitron checks the new certificate with AEAT before it replaces the current one. Sales are not affected. | Waitron comprueba el nuevo certificado con la AEAT antes de sustituir el actual. Las ventas no se ven afectadas. |
| busy | Checking with AEAT… | Comprobando con la AEAT… |
| passphrase_wrong | This passphrase does not open the file. | Esta contraseña no abre el archivo. |
| unreadable | Waitron cannot read this file. Choose the .pfx or .p12 file. | Waitron no puede leer este archivo. Elige el archivo .pfx o .p12. |
| no_private_key | This file has no private key. Export it again with the private key. | Este archivo no tiene la clave privada. Vuelve a exportarlo con la clave privada. |
| expired | This certificate expired on {date}. | Este certificado caducó el {date}. |
| not_yet_valid | This certificate is valid only from {date}. | Este certificado solo es válido desde el {date}. |
| other_taxpayer | This certificate is for tax ID {nif}, not {taxpayerNif}. | Este certificado es del NIF {nif}, no del {taxpayerNif}. |
| same | This certificate is already installed. | Este certificado ya está instalado. |
| too_large | This file is too large to be a certificate. | Este archivo es demasiado grande para ser un certificado. |
| check failed (bottom) | AEAT did not answer a check with this certificate. The current certificate is unchanged. Check the certificate type, then try again. | La AEAT no ha respondido a una comprobación con este certificado. El certificado actual no cambia. Comprueba el tipo de certificado y vuelve a intentarlo. |
| AEAT refused (bottom) | AEAT refused this certificate for {taxpayerNif} ({codigo}). The current certificate is unchanged. | La AEAT ha rechazado este certificado para {taxpayerNif} ({codigo}). El certificado actual no cambia. |
| changed (bottom) | Someone else installed a certificate meanwhile. Close this window to see it. | Otra persona ha instalado un certificado mientras tanto. Cierra esta ventana para verlo. |
| alert `fiscal.certificate_expiring` | The AEAT certificate expires on {date:date}, in {days} day(s). Install the new one in Venue settings before then, or fiscal records will wait. | El certificado de la AEAT caduca el {date:date}, dentro de {days} día(s). Instala el nuevo en Ajustes del local antes de esa fecha o los registros fiscales quedarán en espera. |
| alert `fiscal.certificate_expired` | The AEAT certificate expired on {date:date}. Sales continue, but fiscal records wait until you install a new one in Venue settings. | El certificado de la AEAT caducó el {date:date}. Las ventas continúan, pero los registros fiscales esperan hasta que instales uno nuevo en Ajustes del local. |
| alert `fiscal.awaiting_certificate` (reworded) | Fiscal records are waiting because no AEAT certificate is installed. Install it in Venue settings. | Hay registros fiscales en espera porque no hay ningún certificado de la AEAT instalado. Instálalo en Ajustes del local. |

The "(s)" plural follows the sibling alerts (`fiscal.submission_delayed`). None of the alert texts
promises a later check by the server (the rule in `alert-messages.ts`'s header).

---

## 8. Build slices and review path

**FULL path**: fiscal-adjacent, a migration, a permission and a route that writes a secret. Per-task
reviews, the whole `/finish-branch` wave, and the Codex run-it seat twice (risk-trigger branch). The
owner lands it.

1. **Read and check a certificate file** (`fiscal-verifactu/src/certificate.ts`, pure functions).
   Tests build their own files the way `make-fixtures.sh` does — valid, expired, not yet valid, other
   tax ID, no private key, wrong passphrase, random bytes, no `organizationIdentifier` — and each
   refusal asserts its code and field.
2. **The install record and setup's seal.** New table, migration, `appendOnly()` classification,
   manifest entry; `provisioningSecret.seal` writes vault entry and record in one transaction, once per
   fingerprint. Runs the migration guards CLAUDE.md §3 names.
3. **The routes and the live check.** `GET`/`POST /management-api/fiscal-certificate`; permission per
   Q1; the consulta through `mtlsFetch` against a local mutual-TLS server in tests
   (`@waitron/server-kit/testing/mtls.js`, as `aeat-transport.test.ts` does); the revision check; a
   test that a sale commits while a live check is held open; a test that a pass after the install uses
   the new certificate (P4's shape) and one already running finishes with the old (E6).
4. **The card and the dialog.** Module dashboard contribution, strings in both languages, the form
   rules, a11y in both themes, an unsaved-changes test, phone width.
5. **The expiry alerts.** Source, codes, wording, the `{name:date}` slot, the link on
   `fiscal.awaiting_certificate`, and the guard list.
6. **Only if Q3 is yes:** the reminder email.

**Before landing, with a real certificate** (the owner's, through the operator-run
`aeat.preprod.test.ts` pattern): a consulta to production AEAT, and a consulta with a company seal at
`www10`. If either does not answer as §3.5 step 7 expects, the live check is redesigned before landing,
not shipped on assumption. Also record where a real seal keeps the company's tax ID (§2.7).

---

## 9. Questions for the owner

Three, one at a time, each with a recommendation. Everything else above was decided against a house
precedent named beside it.

### Q1 of 3 — Who may replace the certificate?

_Example:_ Jordi is a manager at Bar Lucía. The certificate expires in 10 days and Marta, the
administrator, is away. Can Jordi install the new file Marta emailed him?

- **A (recommended): managers and administrators**, through the existing `system.manage` — the
  permission behind the email server and backup bucket settings; card-provider keys are also
  manager-level. Jordi can do it. No new permission, which follows your 26 Sep wish to reuse
  rather than add. A mistake can only stop filing, never file under the wrong taxpayer: the tax ID
  check and AEAT's own answer come first.
- **B: administrators only**, through a new permission `fiscal.configure`, as the reverted 7 Sep design
  had it. Jordi cannot; Marta must do it from wherever she is.

### Q2 of 3 — How early should the warning start?

_Example:_ Bar Lucía's company seal expires on 25 Oct 2026. A seal cannot be renewed: FNMT needs a
fresh application, a Registro Mercantil certificate under 15 working days old, and a manual check —
weeks, not minutes. A personal certificate renews online only in its last 60 days.

- **A (recommended): 60 days** — amber from 26 Aug, red from 11 Oct (14 days).
- **B: 30 days** — amber from 25 Sep, red from 11 Oct. Fewer days with an alert showing, but a seal
  started then may not arrive in time.

### Q3 of 3 — Should the box also email when expiry nears?

_Example:_ Marta is away from 17 Oct to 2 Nov and rarely opens the dashboard, so she never sees the
alert, the certificate expires on 25 Oct, and the records wait until she is back. A production box
always has an email server set up — setup requires one (`setup-api.ts:752-754`).

- **A (recommended): yes** — one email to each person who may replace the certificate (Q1), when the
  warning starts, at 14 days, and on the day it expires. It needs a small daily job and a record of
  which emails went out. Nothing else in Waitron emails alerts yet, so this would be the first.
- **B: no** — the dashboard alerts only. An emailed alert, for this and other alerts, becomes its own
  backlog item.

---

## Mockups

PNG files in [`docs/backlog/mockups/a795-aeat-certificate/`](../../backlog/mockups/a795-aeat-certificate/),
built from HTML that loads the real `--wt-*` token files
(`/Users/clintongormley/waitron-campaign/a795-mockups-src/build.mjs`). They show layout and wording; the
build draws them with the real `wt-*` components.

| File | What it shows |
| --- | --- |
| `01-card-light.png`, `01-card-dark.png` | the card, healthy (350 days left), both themes |
| `02-card-warning-phone-light.png` | the amber warning at phone width (390 px) |
| `03-card-expiring-light.png`, `03-card-expiring-dark.png` | the red state, 14 days left (E1) |
| `04-replace-dialog-light.png`, `04-replace-dialog-dark.png` | the Replace dialog, filled in |
| `05-replace-dialog-phone-light.png` | the dialog at phone width |
| `06-checking-light.png` | while the live check runs |
| `07-refusal-wrong-passphrase-light.png` | E2 |
| `08-refusal-other-taxpayer-dark.png` | E3 |
| `09-refusal-expired-file-light.png` | E4 |
| `10-check-failed-light.png` | E5, AEAT did not answer |
| `11-card-renewed-light.png` | after E1's install |
| `12-alert-warning-light.png`, `13-alert-expiring-dark.png` | the expiry alert, amber and red (E7's dates) |
| `14-alerts-expired-away-light.png` | E7 after expiry: the expired alert and the delay alert |
| `15-card-spanish-light.png` | the card in Spanish |
