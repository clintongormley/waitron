# A1089: explain persistent AEAT certificate-check failures

_2026-10-29 implementation update: the owner's 08:07 instruction approves the
reviewed read-only build. Contracts and the local query adapter are on
`feat/a1089-certificate-diagnosis`; process supervision, authorization, the route
and the screen remain unbuilt. Persistent repair remains open. The earlier
proposal and planning-only statements below describe their publication state._

_2026-10-29: the owner approved option A for planning only at 01:58. The
[implementation plan](../plans/2026-10-29-a1089-aeat-certificate-diagnosis.md)
keeps persistent repair open; its build needs separate approval. The proposal and its
measurements below remain the historical record._

**Proposed, 2026-10-28. Not approved. No build authority.** This proposal follows A1089's requirement
for an owner decision on a substantial missing recovery workflow. Its scope, limits and timings
are the design writer's recommendations.

## Why another check is not enough

When replacement keeps failing, you can change file/type, Save to check again, or Cancel; there is no
separate installed-certificate check. Connection/HTTP failures do not prove cause, retryability or a Waitron fault.

The requested outcome includes diagnosis **and an applicable repair**, with sign-in at the action
([backlog](../../backlog.md), A1089; [remaining workflow](../../backlog/self-service-refusals.md#certificate)).
The first cut supplies bounded evidence and existing certificate-editing choices. **Persistent
host-network/configuration and external-refusal repair remain OPEN. This does not close A1089.**
A read-only query cannot supply a DNS, network or proxy repair screen by itself.

## What the source establishes today

Source references below describe `1b841a8ff`. They are inspection receipts unless covered by
the executed checks below; paths are relative to the repository root.

| Boundary | Present behaviour and receipt |
| --- | --- |
| Entry and authority | The module panel declares `system.manage` for changes and `fiscal.view` for reading (`packages/fiscal-verifactu/src/dashboard/index.ts:15`). GET authorises `fiscal.view`; POST authorises `system.manage` and refuses a non-filing box (`apps/server/src/fiscal-certificate-api.ts:51`, `:86`). |
| Browser call chain | The card opens the replacement dialog; read-only/non-filing cards hide its action (`packages/fiscal-verifactu/src/dashboard/certificate-card.ts:183`). Save sends file, passphrase, type and expected revision through `client.install` (`dashboard/certificate-dialog.ts:178`, `dashboard/client.ts:53`, both under `packages/fiscal-verifactu/src/`). Unknown answer reasons use `check_failed` wording (`dashboard/certificate-dialog.ts:60`). |
| Card read | It reads install metadata, credential revision and last accepted filing; it does not decrypt the credential (`packages/fiscal-verifactu/src/certificate-card.ts:65`). This is not a live certificate check. |
| Install | Local checks precede the live check. Refusal returns before the vault write; success re-authorises, checks expiry/revision, writes the credential and records installation (`packages/fiscal-verifactu/src/certificate-install.ts:184`, `:207`, `:232`). Save is therefore not a read-only diagnostic action. |
| Query and target | `checkWithAuthority` calls `consultar` for the taxpayer and current venue-local month (`packages/fiscal-verifactu/src/certificate-check.ts:53`). Environment and certificate kind select the endpoint (`packages/fiscal-verifactu/src/aeat-transport.ts:77`); installed material is read from `fiscal.aeat` (`:65`). |
| Evidence lost | HTTP errors retain status; timeout/name-resolution/refused-connection share `unreachable`; socket/reset share `closed`; other failures become `check_failed` (`packages/fiscal-verifactu/src/certificate-check.ts:20`). Those labels are not root-cause proofs. |
| Existing experiments | A real local mutual-TLS server, where both sides present certificates, returns HTTP 403 in `packages/fiscal-verifactu/src/certificate-check.test.ts:194`; its server requires a trusted client certificate (`packages/fiscal-verifactu/test/certificate-fixtures.ts:259`). Injected `EPROTO` and an unparseable local HTTP 200 both expect `check_failed` (`certificate-check.test.ts:178`, `:203`). These fixtures establish no AEAT policy or live refusal cause. |
| Limits | The check sets a 30-second abort timer by default, then awaits pool close without a separate deadline (`packages/fiscal-verifactu/src/certificate-check.ts:55`, `:72`; `aeat-transport.ts:101`). PFX opening is synchronous (`packages/fiscal-verifactu/src/certificate-file.ts:46`). Dashboard request deadlines currently apply to GET, not POST; there is no caller-supplied cancellation signal (`packages/dashboard-kit/src/request.ts:21`, `:99`). |
| Module boundary | `FiscalCertificateSeat` exposes read/install/alerts/reminders, with no diagnostic method (`packages/fiscal/src/contribution.ts:43`). Veri*Factu fills that seat (`packages/fiscal-verifactu/src/slot.ts:110`); boot mounts it conditionally (`apps/server/src/boot.ts:2095`). |

The scoped search inspected the certificate paths, Box status, generic diagnostics, `deploy/waitron.sh`
and `network|dns|proxy` matches in server API/route/endpoint files. The certificate API exposes
read/install (`apps/server/src/fiscal-certificate-api.ts:51`, `:69`); generic diagnostics exposes
logs/verbosity (`apps/server/src/diagnostics-api.ts:71`, `:85`, `:98`). No applicable DNS/network/proxy
repair action was found there. This is not an exhaustive host/deployment audit or proof of impossibility.

**Executed 2026-10-28 in the registered documentation worktree**, exit status 0 for each:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-check.test.ts src/certificate-install.test.ts src/certificate-install.concurrency.test.ts
# 3 files, 60 tests passed
pnpm --filter @waitron/server exec vitest run src/fiscal-certificate-api.test.ts src/fiscal-certificate-api.verifactu.test.ts
# 2 files, 21 tests passed
```

The unchanged suites exercise their local fixtures, refusal preservation, concurrency and route
boundaries. They do not qualify live AEAT, the proposed diagnostic flow or host-network repair.

## Proposed experience

Add **Diagnose connection / Diagnosticar conexión** to the installed card and failed replacement
dialog. Opening it makes no query. Show the material, configured environment/type and destination;
explain that no invoice is filed and nothing installed. **Run check / Comprobar** starts one attempt.

- From the card, select **Installed certificate / Certificado instalado**. Read the actual vault
  material and kind, bound to the card's expected revision. Missing/unusable material is a local
  finding, not a network diagnosis; offer the existing Install/Replace editor and Stop.
- From the failed dialog, default to **Selected replacement, not installed / Sustitución elegida,
  sin instalar**. Bind exact bytes, passphrase, kind and draft generation. Offer installed material
  separately when present; never silently substitute it or combine evidence from two certificates.
- Show kind and installation time for installed material, or the candidate's local attempt label.
  Keep revision/draft identity internally, without tax IDs/fingerprints. Any source/draft edit invalidates results.
- Results separate **Observed / Observado**, **Cause / Causa** and **Available choices / Opciones**.
  Success says only that this query completed at the shown time. It neither promises future
  filings will succeed nor installs the candidate. Return to the editor for a separate Save,
  which still performs all existing checks; a diagnostic result is never an installation token.
- **Check again / Comprobar de nuevo** starts another bounded attempt by choice. **Edit selected
  file or type / Cambiar archivo o tipo** returns to the existing editor. **Stop / Parar** closes
  diagnosis without changes; closing the replacement editor retains its unsaved-changes question.

Example HTTP wording: “The check received HTTP 403. The cause is not established. Nothing was
changed.” / “La comprobación recibió HTTP 403. No se ha determinado la causa. No se ha cambiado nada.”
For a persistent unresolved result, say that repair is not available in this panel. Do not replace
that honest limit with a referral, a fictitious repair button or a promise that retry will fix it.

## Proposed evidence and authority contract

Add a diagnostic method to the optional fiscal certificate seat and user-invoked POST at
`/management-api/fiscal-certificate/diagnose`. The server passes opaque input to the module, which
validates it and owns certificate/AEAT semantics. Keep browser-safe JSON types and no direct regime imports.

Require `system.manage` and filing eligibility before decryption or network work; `fiscal.view`
alone is insufficient. Re-authorise before returning evidence and recheck installed revision;
a changed revision returns stale. Use `authorizeManager(..., touch: false)` to avoid session writes
(`packages/identity/src/manager-login.ts:162`; `management-session.ts:87`, same directory).
Persist no diagnostic result, alert, install row, credential, fiscal record or counter.
Normal sign-in/session creation remains a separate identity operation.

Keep a sign-in action visible to read-only card viewers. Offer it in diagnosis when authority is
missing/expired, with Stop and no automatic probe after login. Reuse login methods, second factors,
throttling and server-derived permissions (`apps/server/src/management-api.ts:890`;
`packages/identity/src/manager-login.ts:74`; `apps/dashboard/src/dashboard-app.ts:1518`). Explain
the dashboard account change; discard candidate secrets on account change, request file/passphrase
again, and reconfirm the source before Run check.

New shell integration is required: `admin-sign-in` calls logout (`apps/dashboard/src/dashboard-app.ts:2580`,
`:1544`); own-password confirmation concerns the current account (`apps/server/src/own-password-ahead.ts:15`).
Extend the generic module context with a permission/sign-in continuation hosted at this surface;
there is no such hook today (`packages/dashboard-kit/src/contract.ts:14`). Keep account-existence
protections and explicit passkey gestures. Stop submits no candidate material and grants no rights.

| Observed evidence to retain | Meaning and permissible next step |
| --- | --- |
| Local open/validity/taxpayer check failed | Explain the specific local finding without identifiers; return to the existing file/passphrase/type editor. Do not infer the correct type from HTTP or silently change it. |
| Name lookup failed, connection refused, deadline elapsed, connection closed, allowlisted TLS/protocol failure | Record only the observed category, including reset as a closed connection. The cause remains unestablished; no automatic certificate-rejection or DNS/proxy repair claim. |
| HTTP response received, numeric status; structured SOAP fault detected | Record the response category/status only. No temporary/permanent judgement, provider attribution or remedy inferred from the number or fault text. |
| HTTP 200 received but reply cannot be parsed | Preserve both facts separately from an `EPROTO` failure with no observed HTTP response. Unknown errors remain unknown, not proven Waitron bugs or retryable refusals. |
| Query parsed successfully | Show completion time and selected material; offer return/Stop, never install or “connection repaired”. |

Capture status and parse completion separately before classification. Reuse `consultar`; never
submit, drain, retry-outbox or run a fiscal test. Use the taxpayer identity inside the query only;
exclude it and returned invoice data from diagnostic output. No AEAT policy interpretation is proposed.

## Proposed bounds, cancellation and privacy

Use the same `aeatEndpointFor(environment)(certKind)` selection as installation and filing.
Fix destinations server-side; reject caller URLs/hosts/ports, redirects and automatic alternate
hosts. Keep TLS verification enabled. Never change host environment, trust stores, proxy/DNS
settings or production into a test environment as part of diagnosis.

Allow one diagnostic attempt per box, without holding a database transaction over network work
or blocking sales/installation. Keep the existing 200,000-byte request and 100 KiB PFX limits.
Budget 30 seconds for opening, TLS, reply reading and parsing; cap replies at 1 MiB and report
“reply exceeds diagnostic limit” separately. Allow two seconds for pool cleanup. Isolate native
PFX/TLS work in a diagnostic child; terminate only its recorded child if opening/cleanup stalls.
Current synchronous opening and graceful-only close do not supply this bound. Demonstrate it before shipping.

Add explicit abort/deadline support for this POST through the shared request contract; propose a
35-second browser deadline. Stop, disconnect and expiry abort the attempt. Close/reopen, source
edits and newer attempts advance a generation; late answers cannot change the new panel, clear its
busy state or trigger Save. A lost browser response means “result unavailable”, never cause proof.

Allowlist response/log/copy fields: schema version, opaque attempt label, source mode, configured
environment/type/endpoint label, timestamps/duration, observed stage/category, numeric HTTP status
and fixed local finding codes. Keep revision/draft binding opaque/transient. Exclude raw SOAP/bodies,
fault strings/codes, exception messages/stacks/causes, keys/PFX/passphrases, tax IDs, names, certificate
subjects and network/proxy addresses. Map unknown values to a fixed unknown category. Copy is explicit;
no saved history, automatic export or verbosity change.

## Prospective acceptance checks, not completed verification

1. Test the real diagnostic route/seat with installed and candidate certificates of different kinds.
   Assert exact selected material/endpoint, one consulta, zero submissions and zero install calls.
   In an isolated real venue database, compare vault bytes/revision, install rows, session stamps,
   fiscal records and number counters before/after success, refusal, timeout and cancellation.
2. With local mutual TLS, distinguish HTTP 403, malformed HTTP 200, injected EPROTO, socket reset,
   DNS failure, timeout, SOAP fault and unknown error. Assert observations and absence of cause,
   retryability or product-bug claims. Redirects/arbitrary targets must send no second request.
3. Missing/expired/revoked session, missing `system.manage` and non-filing status send no probe.
   Revocation during the wait returns no evidence. Exercise in-place login, second factor, Stop,
   account changes, revision changes and candidate reselection through the real shell/module seam.
4. Hold native opening, response body and cleanup separately. Assert the deadline, child/pool
   release and ability to start another attempt. Hold a probe while an ordinary sale completes;
   retain existing installation/concurrency assertions rather than rewriting them to fit diagnosis.
5. Close/reopen and change drafts during delayed answers. Assert no stale repaint, install event,
   Save request or busy-state release. Seed secrets/tax IDs/raw fault text in every failure and
   assert they appear nowhere in response, UI, logs or copied evidence.
6. Cover EN/ES, keyboard/focus, announced states, both themes and phone width with visual inspection
   and accessibility checks. Update both `apps/server/src/guide/{en,es}/aeat-certificate.md` with
   shared heading IDs and working help links. Preserve form and unsaved-draft conventions.

Preserve keys, installed material/revision, fiscal evidence and all H2 protections: `computeHuella`,
hash chain, invoice-number allocation, `registros_facturacion`, alta builders, `registerSif` and
`restoreFiscal`; golden huella/inmutabilidad assertions and fixtures stay unedited. Any protected
dependency returns to the owner with exact source lines.

## Alternatives and the one owner decision

**A. Evidence first, recommended:** the partial read-only flow separates observations and uses
the existing editor, with new sign-in/timeout integration. It does not repair persistent host-network
or external refusals. Keep that repair workflow and A1089 open for a separately evidenced design.

**B. Design complete recovery first:** audit host configuration ownership and establish specific,
authenticated repairs and risks before proposing an integrated workflow. This better meets A1089
but delays evidence improvements. DNS/network/proxy repair remains work to establish, not an existing choice.

**Owner decision required:** authorise A for planning, leaving persistent host-network/configuration
and external-refusal repair OPEN, or require B first. This proposal grants no implementation authority.
