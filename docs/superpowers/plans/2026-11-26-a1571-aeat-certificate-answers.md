# A1571: what AEAT's answers to real certificates change — plan

Ask: [A1571](../../backlog/fiscal.md#a1571-what-aeats-answers-to-real-certificates-change), from the
owner's certificate session of 2026-11-25 ([record](../../compliance/first-aeat-contact.md#2026-11-25--real-certificates-against-both-environments)).
Fiscal-adjacent: nothing here changes the hash, the chain, numbering or what is filed; the owner
lands every pull request. Golden huella and `inmutabilidad` pass unedited. Fresh read:
`~/waitron-campaign-c/a1571/plan-read-report.md` (one critical, four important, all folded in).

**When all three land:** a person installing a certificate AEAT will not take is told "AEAT did
not accept this certificate", in the dashboard and in setup's first fiscal test; if AEAT stops
taking the installed one, the certificate card says so and an alert names it; a certificate
exported from a Mac's Keychain Access installs and files; nobody is asked the certificate's type;
a representative AEAT will not let file for this company reads "AEAT refused this certificate for
B12345678 (4112)".

Three pull requests, each working on its own and in this order. PR 3 is the part SETUP-CERT-FIRST
moves around; PR 2 gives both the one place where the server opens a setup certificate.

## PR 1. AEAT's answers (parts 1 and 4)

**Task 1. A redirect from AEAT is a refusal wherever the certificate is sent.** `mtlsFetch`
(`aeat-transport.ts:95`) sends with `redirect: "manual"`, placed after `...init` so no caller can
override it. A 3xx whose `Location`, resolved against the request address with `new URL`, has a
last path part of `erro4011.html` or `erro4033.html` cancels the body and throws
`AppError("fiscal.certificate_not_accepted", { page })` (new code in `errors.ts`) from inside the
fetch; `@waitron/verifactu` keeps it as the cause of a `network` error (`dist/client.js:94-95`).
Any other 3xx reaches the library as an HTTP status: the check then says `aeat_http` with that
status where it said `check_failed`. Filing is unchanged: `drain.ts:391` backs every failure off
alike, and the reconcile lookup (`reconcile-runtime.ts:69`) fails as now. Measured by the plan
read: undici's manual mode returns the 302 with `Location` readable, query string included.
Tests: the local TLS server in `aeat-transport.test.ts` answering 302 to each page, to a page with
a query string, and to another page; a control without `manual` follows the redirect.

**Task 2. The dashboard's check says it.** `classify` (`certificate-check.ts:25`) looks for the code
in the cause chain before its `timedOut` branch and returns `{ reason: "not_accepted" }`; the
reason joins `CERTIFICATE_REFUSAL_REASONS`; EN/ES: "AEAT did not accept this certificate. The
current certificate is unchanged. Choose another certificate, or Cancel to stop."

**Task 3. AEAT's number.** A SOAP fault whose `faultstring` starts `Codigo[4112].` (measured: HTTP
200, `env:Client`) returns `{ reason: "aeat_refused", details: { codigo: "4112", taxpayerNif } }`,
shown as "AEAT refused this certificate for {taxpayerNif} ({codigo})." (A795 decision 11; the tax
number in details follows `other_taxpayer`, `certificate-install.ts:151`). Only 4112 was measured,
so another number keeps today's raw-fault sentence.

**Task 4. The installed certificate refused.** `verifactu_sending_state` (one row per venue, travels
with `venue.db` as the vault's one certificate does) gains `certificate_refused_fingerprint` and
`certificate_refused_at`. When a failure's cause chain carries the code, the drain takes the
fingerprint of the certificate it sent with (the transport opens the decrypted file with
`openCertificateFile`, which the install's opener runs too), and the failure transaction stores it
and the pass's own `now`, keeping the first date while the fingerprint is unchanged. When the
database refuses that transaction, the drain keeps the fingerprint and date with the technical
failure it already holds in memory and saves them when that failure is saved. A duplicate lookup
refused the same way is marked in the transaction that saves the batch's other outcomes. Any other
answer from AEAT clears both (`closeOnAnswer`). The card and the new alert compare the stored fingerprint
with the latest install record's, so a new install hides the mark at once, a takeover's clocks
cannot matter, and rotating the vault key, which re-encrypts the same certificate, keeps it. (The
vault's credential revision was the first choice, and rotation changes it; 2026-11-27.) Card:
"AEAT did not accept this certificate on {date}. Install a new one." in place of the days-left
line. Alert `fiscal.certificate_not_accepted` (error, `venue-settings`, since the date) from
`certificateAlerts`, guarded by `scripts/ongoing-alert-codes.test.ts`, wording EN/ES in
`apps/dashboard/src/i18n/alert-messages.ts` beside `fiscal.certificate_expiring`.
`fiscal.submission_delayed` still shows when records are late. Limit: the mark clears at the next
accepted send or a new install, not when nothing is waiting to send. Schema change:
fiscal-verifactu's starting migration is rebuilt (`migration-baseline rebuild`); **venues reset**
(PR's first line).

**Task 5. Setup's first fiscal test says it.** `readinessRejections`, given the sample's node, reads
the mark in the sample database the readiness drain used, so `fiscal-readiness-runner.ts:144-157` answers `rejected` with
a certificate refusal instead of `uncertain`; setup words it as Task 2 does, EN/ES.

Guide EN/ES: `apps/server/src/guide/{en,es}/aeat-certificate.md` gains one sentence under its
dashboard-check section for the card line. Backlog: A1571's bullets 2, 3 and 5 go.

## PR 2. A Mac export opens (part 2)

The alternative of turning on Node's legacy switch was measured and rejected: it opens the file
(`node:26-slim`, Node 26.13.1, OpenSSL 3.5.9) without changing TLS's cipher lists, but Cloud's
backup verifier must run without it (`docs/developers/conventions-data.md:5850`), so every backup
of a venue with such a file would read "unsupported" there.

**Task 6. The opener converts an old file once.** When `createSecureContext` refuses a file as
old encryption, the opener child reads it with node-forge (`pkcs12FromAsn1`) and writes it again
with AES-256 (`toPkcs12Asn1`, same passphrase), opens the result with Node, and returns its bytes
with the details; `old_encryption` stays for a file forge cannot read either. Measured by the plan
read: plain Node opens forge's rewrite of an RC2-40 file, 0.08 s with start-up. node-forge moves
from `fiscal-verifactu`'s dev dependencies to its dependencies (the image already ships it,
`apps/server/package.json:84`). The dashboard install stores the converted bytes.

**Task 7. One place opens a setup certificate.** `validateSetupAeatCert`
(`provisioning-secret.ts:73`) returns the cleaned secret (converted bytes), and
`provisioningSecret.validate`'s contract (`packages/fiscal/src/contribution.ts:218-227`) returns it
for the host to use from then on: the publication digest, the readiness binding
(`fiscal-readiness-input.ts`) and the seal. The four doors that bring the raw secret in
(`setup-provision-input.ts:274`, `setup-first-fiscal-api.ts:285`, `first-fiscal-activation.ts:81`,
the operator settings file) all pass through it. Cross-package contract: full review.

Tests: an RC2 file signed by the test authority, made with `openssl pkcs12 -export -legacy` and
committed with its recipe beside `RC2_CANDIDATE` (`test/openssl-certificates.ts`; forge cannot
write RC2), installs, files over mTLS to the local test server, and reads `ok` in the backup
verifier; an accented passphrase; a chain of certificates; the fingerprint and the "already
installed" refusal unchanged by conversion. The pins that an RC2 file is refused
(`certificate-file.test.ts:47`, `backup-verification-secrets.test.ts:399`) stay: those readers do
not convert. Guides: the `old_encryption` sentence EN/ES drops "Export it again with AES"; the Mac
steps stay. Backlog: the Mac bullet goes.

## PR 3. The type comes from the file (part 3)

**Task 8. Read the policy.** The opener walks `certificatePolicies` (OID 2.5.29.32) in
`X509Certificate.raw` (Node exposes no policy list) and returns `kind: "sello"` only when a seal
policy is present, `"representante"` otherwise, never throwing on a malformed extension. Seal
policies, quoted from their sources on 2026-11-26: ETSI EN 319 411-2 V2.6.1 §5.3 QCP-l
`0.4.0.194112.1.1` and QCP-l-qscd `0.4.0.194112.1.3`; FNMT's Sello de Entidad
`1.3.6.1.4.1.5734.3.11.4` and its G2 `1.3.6.1.4.1.5734.3.22.1.0` (`dpc_sello_entidad.pdf` v1.0,
"Tipo de política asociada: QCP-l"). FNMT's six representative policies (`3.11.1`–`.3`,
`3.21.1.0`–`3.21.3.0`) all name QCP-n `0.4.0.194112.1.0` (`dpc_representacion.pdf` v3.0);
Firmaprofesional's representatives carry QCP-n or QCP-n-qscd and its seals QCP-l or QCP-l-qscd.
Limit, stated at the check: a non-qualified seal (Camerfirma sells one) carries no QCP-l and reads
as representative; the owner needs no seal (2026-11-25), and A853 owns seals.

**Task 9. Nobody is asked.** The type field goes from setup's certificate page, the dashboard
dialog and the diagnosis panel; the request bodies lose `certKind` and Task 7's seat fills it from
the opened file; the vault, the install row and the card keep it. Consumers to trace (the plan
read counted 316 uses in 93 files, about 60 of them tests): beyond the obvious screens and routes,
`purposes.ts:22`, `certificate-dates.ts` (reminder days depend on the kind), `slot.ts:49`,
`certificate-diagnosis-contract.ts`, `dashboard/certificate-diagnosis*.ts`,
`fiscal-certificate-api.ts`, `apps/server/README.md`, `WAITRON_CERT_CHECK_KIND` and
`WAITRON_CERT_CHECK_ADDRESS_KIND` (the preproduction harness keeps choosing the address), the
provisioning CLI fixtures and `held-setup-database.ts`; the comment at `aeat-transport.ts:66-68`
goes. Guide EN/ES: the type mentions at `aeat-certificate.md:30, 44, 51-52, 83`. Tests: forge-made
certificates carrying each seal policy, a representative policy, none, and a malformed extension.
Backlog: the type bullet goes; A1571 keeps a short entry for the slow opener and the "not
established" list.

## Checks, every PR

Focused tests per task; `scripts/errors-reachable.test.ts`; in PR 1 also
`scripts/ongoing-alert-codes.test.ts` and the schema guards (`schema-constraints`,
`append-only-triggers`, `behavioural-triggers`, `classification-complete`, `starting-migrations`)
and `inmutabilidad`; golden huella unedited. Screens changed: pictures EN and ES, light and dark,
phone and desktop, to the watcher for the owner before landing.

## Not done

The slow opener (0.9 s of 2 s) is not changed. Expiry alone, a seal at either address and a
Windows export stay unmeasured. The diagnosis tool keeps its own answer categories (it already
sends with `redirect: "manual"`, `certificate-diagnosis-transport.ts:72`); only its type choice
goes, in PR 3. Every failed batch still marks its records with the technical-incident flag, a
certificate refusal included (since `9eb9ac6e87`); whether AEAT counts that as an incident is a
question for the adviser.
