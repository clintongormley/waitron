# A1571: what AEAT's answers to real certificates change — plan

Ask: [A1571](../../backlog/fiscal.md#a1571-what-aeats-answers-to-real-certificates-change), from the
owner's certificate session of 2026-11-25 ([record](../../compliance/first-aeat-contact.md#2026-11-25--real-certificates-against-both-environments)).
Fiscal-adjacent: nothing here touches the hash, the chain, numbering or what is filed; the owner
lands both pull requests. Golden huella and `inmutabilidad` pass unedited.

**When both land:** a person installing a certificate AEAT will not take is told "AEAT did not
accept this certificate"; if AEAT stops taking the installed one, the certificate card says so and
an alert names it; a certificate exported from a Mac's Keychain Access installs and files; nobody
is asked the certificate's type; a representative whose certificate AEAT will not use for this
company reads "AEAT refused this certificate for B12345678 (4112)".

Two pull requests, each working on its own: **PR 1 = parts (1) and (4)** (what AEAT says),
**PR 2 = parts (2) and (3)** (what the file is). PR 2 is the one SETUP-CERT-FIRST moves around,
and it only removes a field from the setup page.

## PR 1. AEAT's answers

**Task 1. A redirect from AEAT is a refusal, everywhere the certificate is sent.** `mtlsFetch`
(`aeat-transport.ts`) sends with `redirect: "manual"`. A 3xx whose `Location` ends in
`erro4011.html` or `erro4033.html` cancels the reply's body and throws
`AppError("fiscal.certificate_not_accepted", { page })` from inside the fetch (a new code in
`errors.ts`); `@waitron/verifactu` wraps it as a `network` error with it as cause
(`dist/client.js:95`). Any other 3xx reaches the library as an HTTP status, as today. Effect on
filing: none — `drain.ts:391` backs every failed batch off alike, so the batch is retried exactly as
it is now; the reconcile lookup (`reconcile-runtime.ts:69`) also just fails, as now. Tests: a local
TLS server answering 302 to each page and to another page (the existing `aeat-transport.test.ts`
server); a control showing the old code followed the redirect.

**Task 2. The live check says it.** `classify` (`certificate-check.ts`) finds the code in the cause
chain (`firstCodeInCauseChain`, already used there) and returns `{ reason: "not_accepted" }`; the
reason joins `CERTIFICATE_REFUSAL_REASONS`; the dialog shows, EN/ES, "AEAT did not accept this
certificate. The current certificate is unchanged. Choose another certificate, or Cancel to stop."
The `check_failed` and `aeat_http` sentences lose "or certificate type" only in PR 2.

**Task 3. AEAT's number in a fault.** A SOAP fault whose `faultstring` starts `Codigo[4112].`
(measured: HTTP 200, `env:Client`) returns `{ reason: "aeat_refused", details: { codigo: "4112",
taxpayerNif } }`, shown as "AEAT refused this certificate for {taxpayerNif} ({codigo})." (A795
decision 11). Only 4112 was measured, so any other number keeps today's raw-fault sentence.

**Task 4. The installed certificate refused.** `verifactu_sending_state` gains
`certificate_refused_at` (nullable). The drain's failure path (`drain.ts:391-410`) sets it, in the
backoff transaction, when the failure's cause chain carries `fiscal.certificate_not_accepted`; any
answer from AEAT (the `persistResponse` transaction) clears it. A schema change: fiscal-verifactu's
starting migration is rebuilt with `migration-baseline rebuild`, **venues reset** (first line of
the PR). The card (`certificate-card.ts`, server and dashboard) shows "AEAT did not accept this
certificate on {date}. Install a new one." when the stamp is later than the latest install, in
place of the days-left line; a new alert `fiscal.certificate_not_accepted` (error, screen
`venue-settings`, since the stamp, area claim and EN/ES wording for `scripts/alert-codes.test.ts`)
comes from `certificateAlerts` on the same condition. `fiscal.submission_delayed` still shows when
records are late: it is true too, and the new alert says why.

Guides EN/ES: the certificate section of the venue-settings guide gains one sentence on the new
card line. Backlog: A1571's first two bullets and the 4112 bullet go.

## PR 2. The file

**Task 5. A Mac export opens and files.** Measured 2026-11-26 in `node:26-slim` (Node 26.13.1,
OpenSSL 3.5.9) on an RC2-40 file made with `openssl pkcs12 -export -legacy`: `createSecureContext`
refuses it `ERR_CRYPTO_UNSUPPORTED_OPERATION`, and opens it under `--openssl-legacy-provider` (and
under `NODE_OPTIONS=--openssl-legacy-provider`). With the switch on, `tls.getCiphers()` (62) and
`tls.DEFAULT_CIPHERS` are unchanged; only `crypto`'s own lists grow (MD4, RC2 and the like). So the
box turns it on where a certificate is opened or used: the opener child's spawn
(`certificate-open.ts:35`), the diagnosis child (`certificateDiagnosisRuntime`'s `execArgv`), the
image's `ENTRYPOINT` (`deploy/Dockerfile:344`), and the dev server, so a developer sees what a box
does. The guide's Mac steps stay as they are, and the `old_encryption` sentence stops telling Mac
users to do what Keychain Access cannot. Test: an RC2 fixture (forge, already a dev dependency)
opens, installs and is sent over mTLS to the local test server, with the switch on in the
package's Vitest workers; a control without it is refused. The alternative, telling Mac users to
re-export through Firefox, was rejected: several steps for every Mac owner, and the opener's
refusal would stay.

**Task 6. The type comes from the file.** The opener reads the certificate's `certificatePolicies`
(a short DER walk over `X509Certificate.raw`; Node exposes no policy list) and returns
`kind: "sello"` only when a seal's policy is present, and `"representante"` otherwise. Seal
policies, each quoted from its source on 2026-11-26: ETSI EN 319 411-2 V2.6.1 §5.3 QCP-l
`0.4.0.194112.1.1` and QCP-l-qscd `0.4.0.194112.1.3`; FNMT's Sello de Entidad
`1.3.6.1.4.1.5734.3.11.4` and its G2 `1.3.6.1.4.1.5734.3.22.1.0` (`dpc_sello_entidad.pdf` v1.0,
"Tipo de política asociada: QCP-l"). FNMT's six representative policies (`3.11.1`–`.3`,
`3.21.1.0`–`3.21.3.0`) all name QCP-n `0.4.0.194112.1.0` (`dpc_representacion.pdf` v3.0);
Firmaprofesional's representative carries QCP-n or QCP-n-qscd (`…1.2`) and its seals QCP-l or
QCP-l-qscd (its certificate-profiles PDF). Limit, stated in the code at the check: Camerfirma sells
a non-qualified seal, which carries no QCP-l and so reads as representative; the owner needs no
seal (2026-11-25), and A853 owns seals. Tests: forge-made certificates carrying each seal policy,
a representative policy, none, and a malformed extension (reads as representative, never throws). Setup's certificate page and the
dashboard dialog lose the type field; the install, setup and diagnosis request bodies lose
`certKind` (pre-live, renamed freely) and take it from the opened file; the card still shows the
type. Trace every consumer first: `apps/setup/src/api/client.ts`, `cert-screen.ts`,
`provisioning-secret.ts`, `slot.ts`, `certificate-install.ts`, `certificate-diagnosis*.ts`,
`dashboard/client.ts`, `fiscal-certificate-api.ts`, `packages/provisioning/src/fiscal-readiness-input.ts`,
`backup-verification-secrets.ts`, and the server test fixtures that send it. Guides EN/ES lose the
type step. Backlog: the Mac and type bullets go; A1571 is deleted.

## Checks

Focused tests per task; `scripts/alert-codes.test.ts`, `scripts/errors-reachable.test.ts`; for
Task 4 the schema guards (`schema-constraints`, `append-only-triggers`, `behavioural-triggers`,
`classification-complete`, `starting-migrations`) and `inmutabilidad`; golden huella unedited in
both. Screens changed (dialog sentence, card line, setup page without the type field): pictures EN
and ES, light and dark, phone and desktop, to the watcher for the owner before landing.

## Not done

The slow opener (0.9 s of 2 s) is not changed. Expiry alone, a seal at either address and a
Windows export stay unmeasured. The diagnosis tool is not changed: its own transport already sends with
`redirect: "manual"` (`certificate-diagnosis-transport.ts:72`) and reports AEAT's 302 as an HTTP
answer.
