# A853: the box makes a company seal's key itself — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: written 2026-11-28 by lane L, for the watcher's read. FISCAL: the owner lands both pull requests.

**Goal:** on the AEAT certificate card, the box makes a company seal's key and FNMT's request, keeps the key
while FNMT works, installs the certificate FNMT issues, and keeps the seal it replaces until that seal expires.

**Architecture:** all certificate logic stays in `packages/fiscal-verifactu`, reached by `apps/server` only
through the generic `FiscalCertificateSeat` (`packages/fiscal/src/contribution.ts:87`), as today. The waiting
key and the kept seal are two new entries in the store of secrets (`venue_credentials`), so they travel with
backups and to a spare like the installed certificate. The issued seal is packed into a `.p12` and goes
through the same checks and the same final write as **Replace certificate**.

**Tech Stack:** TypeScript, Hono routes, Lit dashboard components, `node:crypto` for the key and for matching
it, the `node-forge` 1.4.3 already in `packages/fiscal-verifactu/package.json:40` for the request and the
`.p12`, Vitest (node and browser projects).

**Spec:** [2026-11-27-a853-seal-key-on-the-box-design.md](../specs/2026-11-27-a853-seal-key-on-the-box-design.md),
with the owner's two answers at its end.

**Base.** `main` at `e2eac48b7a`. Line numbers are that commit's. "Run" names the command; everything else
was read.

**Words.** The *request* is FNMT's PKCS#10 certificate request (a CSR). The *waiting key* is the private key
made for it. The *issued seal* is the certificate FNMT returns. The *kept seal* is the seal an install
replaced, held until it expires (owner's answer 2). *Revision* is `credentialRevision`'s digest of one
stored entry (`packages/credentials/src/store.ts:139-154`), which every write compares with what the card
read.

## 1. Should this exist?

**The ask** (owner, 2026-11-27, `docs/backlog/fiscal.md:892-894`): "I misunderstood what the seal
certificate was for, so I think we do need one, or it'd be better to use one", then "A853 yes". A seal
cannot reach the box today without moving its key, which FNMT forbids (design, first section).
**Simplest alternative:** the owner makes the key and request on a laptop with FNMT's Windows generator
(`cert.fnmt.es/componente/generacion-claves`, read 2026-11-28), combines them into a `.p12` there and uses
today's **Replace certificate**. It needs no code, but makes the key «en una máquina del suscriptor» other
than the box and leaves a copy of the company's key on that laptop; the owner chose the box (the ask).
**Approved:** the ask and the two answers, quoted in the design. D1 to D10 are lane L's, for the watcher.

| # | Decision |
| --- | --- |
| D1 | Two new entries in the store of secrets (`packages/credentials/src/purposes.ts:10-25`): `fiscal.aeat_seal_request` = `privateKeyPem`, `requestPem`, `madeAt`; `fiscal.aeat_previous` = `pfxBase64`, `passphrase`, `certKind`, `fingerprint`, `validUntil`. No migration: `purpose` is a plain label (`packages/db/src/schema/credentials/venue-credentials.ts:17`), listed among tables with no closed vocabulary (`packages/db/src/schema/schema-conformance.test.ts:11-13`) |
| D2 | The card's read (`fiscal.view`) opens those two entries, never `fiscal.aeat`, and returns the request's text, `madeAt`, and the kept seal's dates. This changes `certificate-card.ts:65-66`'s "the vault entry itself is never decrypted" to "the installed certificate's entry". **Show request** is then card data, not a route. `madeAt` sits in the entry because the row's `updatedAt` moves on every re-seal (`store.ts:120-129`, called by `rotateCredentials`, `store.ts:292`) |
| D3 | The key: RSA, 2048 bits, by `node:crypto`'s `generateKeyPair` (FNMT's key page: «Sello (RSA 2048)» for «Certificado de sello de entidad», read 2026-11-28). The request: SHA-256, subject `C=ES`, `O=<legal name>`, `organizationIdentifier=VATES-<tax ID>` from `readTaxpayer`, built by node-forge loaded with `import()` only here. FNMT's own generator asks for no subject (its manual, p. 5), so the subject decides nothing at FNMT |
| D4 | The issued file: at most `CERTIFICATE_MAX_BYTES` (`certificate-limits.ts`); one DER certificate, or PEM holding one or more `CERTIFICATE` blocks, CRLF or LF. The certificate whose public key matches the waiting key (`X509Certificate.checkPrivateKey`) is the seal; every other certificate in the file goes into the `.p12` after it, as stored. No match: refused `not_from_request`. Not readable as either: `unreadable` |
| D5 | The `.p12` is written by a `writePkcs12` moved out of `rewriteOldCertificate` (`certificate-convert.ts:163-201`): raw DER certificates, so node-forge never parses FNMT's certificate (its reader drops certificates it cannot parse, `certificate-convert.ts:73-76`); key under AES-256, SHA-256 MAC. Passphrase: `randomBytes(24).toString("base64url")`, never shown. The file then goes through `openCertificate` like an uploaded one |
| D6 | One pipeline. `installCertificate`'s checks and final write (`certificate-install.ts:164-275`) become `installChecked`, which **Replace certificate**, **Install the issued seal** and **Go back** all call; each adds its own revision check and clean-up to the final write. Decision 18's two transactions stay (`certificate-install.ts:179-184`) |
| D7 | The kept seal (owner's answer 2). In every final write, before the new certificate is stored: a kept seal that has expired, or whose fingerprint is the new certificate's, is deleted; then, if the certificate being replaced is a seal (`certKind` `sello`) and has not expired, it becomes the kept seal, in place of any other. Replacing a representative's certificate keeps nothing new and leaves a kept seal alone |
| D8 | The kind is read from the seal's policies, as for every certificate since #4524 (`certificate-policy.ts:99-106`). An issued seal is never refused for reading as a representative's: its key exists nowhere else, so a refusal would throw away a paid seal. AEAT's live question, sent to the endpoint that kind picks, decides |
| D9 | The kept seal is deleted after expiry by the certificate reminder job's pass (`apps/server/src/certificate-reminder-worker.ts:23-48`), before its email checks, through a new seat method: hourly at most (`:57`), on the primary only (`:55`). Every final write also deletes one (D7) |
| D10 | Refusals. A request revision that differs (making one while one waits, installing or cancelling one that is gone or new) throws a new `fiscal.seal_request_changed` (409). A kept seal that differs from the card's throws the existing `fiscal.certificate_changed` (409). New answer reason `not_from_request`. Every write route authorises as **Replace certificate** does (`fiscal-certificate-api.ts:90-98`) |

**Open points from the design, resolved or marked.**

- **FNMT's download format.** Resolved as far as FNMT says: «Se descargará la parte pública del certificado
  en formato .cer» (`cert.fnmt.es/documents/10446703/10508993/manual_generador_claves.pdf`, p. 16, read
  2026-11-28). No page read says whether `.cer` is DER or PEM, so D4 takes both. Not covered: a `.p7b`
  (PKCS#7) file, which no FNMT page read mentions; it is refused `unreadable`.
- **Whether FNMT's issuing certificate must be kept.** Not resolved by reading: no FNMT page read says, and
  the first live contact found "No intermediate certificate had to be supplied" only for AEAT's own server
  certificate (`docs/compliance/first-aeat-contact.md:33-34`). D4 keeps any extra certificate the file holds,
  and the live question refuses before anything is replaced (Review Focus 4). **Checked against FNMT's page
  in Task 11:** the guide tells the owner which file to download; if FNMT's download page then offers the
  seal with its chain, the guide names that choice. Settled for good only by the first real seal's install.
- **The request's header lines.** Kept off, as the design says. Receipt that either works on FNMT's form:
  its check strips `-----BEGIN CERTIFICATE REQUEST-----` lines before reading
  (`apus20.cert.fnmt.es/SolicitudCertComp/js/PKCS10.js`, `verifyPKCS10`, read 2026-11-28).
- **The download asks for the seal's name and the request code** (FNMT's download form,
  `formularioDescargaSELLO`, read 2026-11-28: «Nombre del componente», «Código de solicitud»), so the steps
  tell the owner to keep both.

**Trial, run 2026-11-28** (Node 26.13.1, OpenSSL 4.1.0, a script in a scratch folder, nothing kept): key by
`generateKeyPairSync` 85 ms; request by node-forge 42 ms, `csr.verify()` true, `openssl req -verify` "OK"
with subject `C=ES, O=BAR LUCÍA S.L., organizationIdentifier=VATES-B12345678`; a stand-in authority's
certificate matched the key from DER and from PEM, and another key did not; a node-forge AES-256 `.p12` under
a base64url passphrase opened in `createSecureContext`, and a wrong passphrase failed "mac verify failure".
The repo's `writePkcs12` path (D5) was not run; Task 1 runs it.

## Global Constraints

- Box is "box" in English and «servidor» in Spanish, never «equipo» (CLAUDE.md §3; the box-word guards).
- General code is English only; Spanish only in translation files and guides (CLAUDE.md §3).
- No `apps/server` file imports `@waitron/fiscal-verifactu` (`scripts/certificate-diagnosis-boundaries.test.ts:20-28`,
  `scripts/module-seams.test.ts`).
- A refusal is an answer, not a throw, except a malformed body, a refused authorisation or a changed revision
  (`certificate-install.ts:159-163`).
- No secret in a log line or an error's params: the waiting key, the request entry, passphrases.
- No transaction is open while AEAT answers or a key is made (`certificate-install.ts:179-184`).
- Every new dashboard dialog holding staged input takes `draftScopeFor` and has a `*.unsaved.test.ts`.
- Product files stay under 1,000 lines: `packages/fiscal-verifactu/src/dashboard/strings.ts` is at 835, so
  the new words go in a new `seal-strings.ts`; `apps/server/src/boot.ts` is at 4,919 of its 5,000 cap
  (`scripts/product-file-size-limits.json:26`).
- Coverage `98/98/98/95` in every package touched.

## Review Focus

1. **The waiting key is lost** (restore of an older backup, a reset) and FNMT's seal arrives later: the card
   offers **Request a company seal** again and the old seal is refused `not_from_request`, never crashes.
   Test: Task 5.
2. **Two managers at once**: one makes a request while another's dialog is open, or installs while another
   cancels: the second write throws `fiscal.seal_request_changed` and writes nothing. Tests: Tasks 4 and 5.
3. **FNMT's file in another shape**: PEM with CRLF, a PEM holding FNMT's certificate first and the seal
   second, DER, a `.p7b`, a `.p12`: the first three install, the others are refused `unreadable`, none
   throws. Test: Task 2.
4. **AEAT refuses the issued seal** (a missing issuing certificate, a revoked seal): nothing is replaced, the
   request and its key stay, the card still shows them so the owner can try again with another file. Test:
   Task 5.
5. **The kept seal expires between the card's read and Go back**: refused `expired`, the installed
   certificate unchanged, the kept seal deleted at the next write or job pass. Test: Task 6.

---

## PR 1 — the server (packages, routes; no screen changes)

**No migration, no venue reset** (D1). Every task also runs, unedited:
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/certificate-install.test.ts src/certificate-install.concurrency.test.ts src/certificate-convert.test.ts`.

### Task 1: `writePkcs12`

**Files:** create `packages/fiscal-verifactu/src/certificate-pkcs12.ts`; modify `certificate-convert.ts`
(`:93-127`, `:163-201`); test `certificate-pkcs12.test.ts`.

**Interfaces.** Produces `writePkcs12(input: { keyPem: string; certificates: readonly Buffer[]; passphrase:
string }): Buffer`: `certificates[0]` is the key's own and carries the local key id; the others follow in
order. `rewriteOldCertificate` keeps its signature and calls it.

- [ ] **Step 1: failing test** `certificate-pkcs12.test.ts`: a file written for a fixture key, its
      certificate and a second certificate opens with `openCertificateFile` (`certificate-file.ts:49`) under
      the passphrase, its fingerprint is the first certificate's, and `createSecureContext` refuses the same
      file under another passphrase; an empty `certificates` throws.
- [ ] **Step 2:** run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/certificate-pkcs12.test.ts`;
      expect FAIL (no module).
- [ ] **Step 3:** move the bag-building and `withMac` into `certificate-pkcs12.ts`; `readOld` and the size cap
      stay in `certificate-convert.ts`.
- [ ] **Step 4:** run the new test and `src/certificate-convert.test.ts` (unedited); expect PASS.
- [ ] **Step 5:** commit `-s`, "Move the PKCS#12 writer out of the old-certificate rewrite".

### Task 2: the request and the issued file

**Files:** create `seal-request.ts`, `seal-issued.ts` in `packages/fiscal-verifactu/src/`; tests beside them;
modify `test/certificate-fixtures.ts` (`FixtureAuthority` gains `issueFor`).

**Interfaces.** Produces:
- `makeSealRequest(subject: { legalName: string; taxId: string }): Promise<{ privateKeyPem: string; requestPem: string }>` (D3).
- `requestText(requestPem: string): string`: the base64 lines only, LF-joined.
- `readIssuedFile(bytes: Buffer): Buffer[] | null`: every certificate as DER, in file order; `null` when not D4's shapes.
- `pairWithKey(certificates: readonly Buffer[], privateKeyPem: string): Buffer[] | null`: the matching one first, then the rest; `null` when none matches.
- Test helper `issueFor(requestPem: string, options?: CandidateOptions): { der: Buffer; pem: string; fingerprint: string }`, signed by the fixture authority with `CandidateOptions`' policies and dates.

- [ ] **Step 1: failing tests.** `seal-request.test.ts`: the request verifies (`forge.pki.certificationRequestFromPem(...).verify()`),
      its key is 2,048-bit RSA, its subject holds `O=BAR LUCÍA S.L.` and `organizationIdentifier=VATES-B12345678`
      (a tax ID typed `b-12345678` normalised by `normaliseTaxId`), and `requestText` has no `-----` line.
      `seal-issued.test.ts`: Review Focus 3's five shapes; a PEM with the authority's certificate before the seal
      pairs the seal first; a certificate for another key gives `null`.
- [ ] **Step 2:** run both files with `--project node`; expect FAIL.
- [ ] **Step 3:** implement. `readIssuedFile` tries DER, then PEM blocks, each through `new X509Certificate`.
- [ ] **Step 4:** run; expect PASS.
- [ ] **Step 5:** commit `-s`.

### Task 3: one install pipeline, and the kept seal

**Files:** modify `certificate-install.ts`, `packages/credentials/src/purposes.ts` (D1), `purposes.test.ts:12-20`
(the purpose list); create `certificate-kept.ts`; tests: new cases in `certificate-install.test.ts`, new
`certificate-kept.test.ts`.

**Interfaces.**
- `installChecked(deps: InstallDeps, material: { pfxBase64: string; passphrase: string; expectedRevision: string | null }, now: Date, extra?: { beforeWrite?(tx: Transaction): Promise<void>; afterWrite?(tx: Transaction, personId: string): Promise<void> }): Promise<InstallAnswer>`;
  `installCertificate(deps, rawBody, now)` keeps its signature and answers.
- `keepReplaced(tx: Transaction, ring: KeyRing, input: { installedFingerprint: string; at: Date; nodeId: string; personId: string }): Promise<void>` (D7), called by `installChecked`'s final write before `putCredential`.
- `dropExpiredPrevious(tx: Transaction, ring: KeyRing, now: Date): Promise<boolean>`.

- [ ] **Step 1: failing tests**, through `installCertificate` (the seat's install, real database): a seal replaced
      by a representative's certificate is kept with its `fingerprint` and `validUntil`; a representative's
      replaced keeps nothing and leaves an earlier kept seal; a second seal replaced takes the kept place;
      installing the kept seal's file deletes the kept entry; an expired kept seal is deleted by any install.
      `certificate-kept.test.ts`: `dropExpiredPrevious` at, before and after `validUntil`, and with no entry.
      `purposes.test.ts`: the two purposes and their fields.
- [ ] **Step 2:** run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/certificate-install.test.ts src/certificate-kept.test.ts`
      and `pnpm --filter @waitron/credentials exec vitest run src/purposes.test.ts`; expect FAIL.
- [ ] **Step 3:** implement; `certificate-install.test.ts`'s existing cases pass unedited.
- [ ] **Step 4:** run Step 2's files and the guards the new purposes reach, unedited:
      `pnpm --filter @waitron/credentials exec vitest run src/backup-verification.test.ts src/cli.test.ts src/rotate.test.ts`,
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/backup-verification.test.ts src/backup-verification-secrets.test.ts`,
      `pnpm --filter @waitron/composition exec vitest run src/credentials-backup-verification.test.ts src/backup-verification.inventory.test.ts`.
      The credentials backup policy lists every purpose (`backup-verification.ts:24`), so its list grows by two;
      a release without them refuses such a backup `unsupported` (`:61`). Pre-live, acceptable; say so in the PR.
- [ ] **Step 5:** commit `-s`.

### Task 4: make, show and cancel a request

**Files:** create `seal-request-store.ts` (the three operations); modify `certificate-card.ts` (D2),
`errors.ts` (`fiscal.seal_request_changed`, beside `:411-416`); tests `seal-request-store.test.ts`, new cases
in `certificate-card.test.ts` (its whole-card `toEqual` at `:109` gains the two `null` fields).

**Interfaces.**
- `makeSealRequestEntry(deps: Pick<InstallDeps, "db" | "ring" | "authorize" | "log">, body: unknown, now: Date): Promise<{ revision: string }>`;
  body `{ expectedRequestRevision: null }`. Read transaction: authorise, taxpayer, revision must be null;
  `makeSealRequest` with no transaction open; write transaction: authorise, revision still null, `putCredential`.
- `cancelSealRequest(deps, body: { expectedRequestRevision: string }): Promise<void>`: one transaction, `deleteCredential`.
- `CertificateCard` gains `sealRequest: null | { revision: string; madeAt: string; request: string }` and
  `previous: null | { revision: string; validUntil: string; organisation: string | null }` (the organisation from
  the newest install row with that fingerprint among `readHistoryNodes`; `null` once `validUntil` has passed).
  `CertificateCardDeps` gains `ring: KeyRing`.

- [ ] **Step 1: failing tests**: a request made, read on the card with its `madeAt` and text; a second make
      throws `fiscal.seal_request_changed` and leaves the first; cancel with a stale revision throws it and
      deletes nothing; cancel deletes and writes `credentials.removed` with the person (`store.ts:196-212`); a
      refused authorisation before and after the key is made writes nothing; the log fields of a make hold no
      `-----BEGIN` text; the card shows a kept seal until its `validUntil` and not after.
- [ ] **Step 2:** run `--project node src/seal-request-store.test.ts src/certificate-card.test.ts`; expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run; expect PASS. Also `src/drain.certificate-refused.test.ts` (reads the card, `:238`).
- [ ] **Step 5:** commit `-s`.

### Task 5: install the issued seal

**Files:** create `seal-install.ts`; test `seal-install.test.ts`; `CERTIFICATE_REFUSAL_REASONS`
(`certificate-install.ts:22-40`) gains `not_from_request`.

**Interfaces.** `installIssuedSeal(deps: InstallDeps, body: unknown, now: Date): Promise<InstallAnswer>`; body
`{ certificateBase64: string; expectedRevision: string | null; expectedRequestRevision: string }`. Read
transaction: the request entry (missing or other revision: `fiscal.seal_request_changed`). Then
`readIssuedFile`, `pairWithKey`, `writePkcs12`, and `installChecked` with `beforeWrite` checking the request
revision again and `afterWrite` deleting the request entry.

- [ ] **Step 1: failing tests**, the AEAT question answered by `startAnsweringServer`
      (`test/certificate-fixtures.ts:270`): an issued seal installs, the card shows it as `sello`, filing's reader
      (`aeat-transport.ts:62-64`) opens it, the request is gone, and the representative's certificate it replaced
      is not kept; a seal for another key is `not_from_request` (Review Focus 1); AEAT's fault leaves the request
      and the installed certificate (Review Focus 4); a cancel landing while AEAT answers makes the write throw
      `fiscal.seal_request_changed` with nothing written (Review Focus 2, held by a transport that waits for a
      signal, as `certificate-install.concurrency.test.ts` does); an issued certificate with no seal policy installs
      as `representante` (D8); a seal naming another tax ID is `other_taxpayer`; an expired one `expired`.
- [ ] **Step 2:** run `--project node src/seal-install.test.ts`; expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run; expect PASS.
- [ ] **Step 5:** commit `-s`.

### Task 6: go back to the kept seal

**Files:** modify `seal-install.ts`; tests in `seal-install.test.ts`.

**Interfaces.** `restorePreviousSeal(deps: InstallDeps, body: unknown, now: Date): Promise<InstallAnswer>`; body
`{ expectedRevision: string | null; expectedPreviousRevision: string }`; the kept entry's material through
`installChecked`. D7 then keeps the replaced certificate when it is a seal.

- [ ] **Step 1: failing tests**: seal B replaced by seal C, go back: B installed, C kept; go back again: C
      installed, B kept; from a representative's certificate: the seal installed, nothing kept; the kept seal
      expiring between read and write is `expired` and is deleted, the installed certificate unchanged (Review
      Focus 5); a stale `expectedPreviousRevision` throws `fiscal.certificate_changed`; AEAT refusing leaves both.
- [ ] **Step 2–4:** run `--project node src/seal-install.test.ts`: FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 7: the seat, the routes and the job

**Files:** modify `packages/fiscal/src/contribution.ts` (`:87-140`), `packages/fiscal-verifactu/src/slot.ts`
(`:127-142`), `apps/server/src/fiscal-certificate-api.ts`, `apps/server/src/certificate-reminder-worker.ts`,
`apps/server/src/boot.ts:3028-3043` (passes `ring`); tests `apps/server/src/fiscal-certificate-api.test.ts`
(fake seat), `fiscal-certificate-api.verifactu.test.ts` (real seat), `certificate-reminder-worker.test.ts`.

**Interfaces.** `FiscalCertificateSeat.read`'s deps gain `ring`. New optional seat members, each
`(deps, body, now)` as `install` is: `seal?: { request; cancel; install; restorePrevious }`, and
`dropExpiredPrevious?(tx: Transaction, ring: KeyRing, now: Date): Promise<boolean>`. Routes, mounted only when
`seal` is present, each with the install's authorise and the 409/400 map gaining `fiscal.seal_request_changed`:

| Route | Body | Answer |
| --- | --- | --- |
| `POST /management-api/fiscal-certificate/seal-request` | `{ expectedRequestRevision: null }` | `{ revision }` |
| `POST …/seal-request/cancel` | `{ expectedRequestRevision }` | `{}` |
| `POST …/seal-request/install` | `{ certificateBase64, expectedRevision, expectedRequestRevision }`, the install's `bodyLimit` | the install's answer |
| `POST …/previous` | `{ expectedRevision, expectedPreviousRevision }` | the install's answer |

The reminder pass calls `dropExpiredPrevious` in its own transaction after `active()` (`:26-27`) and before
`resolveDelivery` (`:28`), so a box with no email still deletes.

- [ ] **Step 1: failing tests**: each route refuses without `system.manage` (403), without a recent sign-in, and
      on a box that does not file (409 `fiscal.certificate_not_used`); the real seat's routes carry one request
      from make to install; the job deletes an expired kept seal with email unconfigured, and not on a
      non-primary.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/fiscal-certificate-api.test.ts src/fiscal-certificate-api.verifactu.test.ts src/certificate-reminder-worker.test.ts`; expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run Step 2's files, `src/boot.certificate-reminders.test.ts`, and the root guards
      `pnpm exec vitest run scripts/certificate-diagnosis-boundaries.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts scripts/product-file-size.test.ts`; expect PASS.
- [ ] **Step 5:** update `docs/backlog/fiscal.md`'s A853 entry: the server is built, the screens are PR 2.
      Commit `-s`.

**Leaves:** the box can do it all, and no screen offers it.

## PR 2 — the card, the setup line and the guides

**No migration, no venue reset.** Browser tests run with
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser <files>`.

### Task 8: the card and the request dialog

**Files:** modify `src/dashboard/client.ts` (the card view's two fields; `requestSeal`, `cancelSealRequest`,
`installIssuedSeal`, `restorePreviousSeal`), `certificate-card.ts` (`#action`, `:217-232`, and `#body`);
create `seal-strings.ts` (its own `registerCatalogue`, as `strings.ts:802-804`), `seal-request-dialog.ts`;
tests `certificate-card.test.ts`, `seal-request-dialog.test.ts`, `.a11y.test.ts`.

The dialog shows the design's words; after **Make request** it shows the request in a read-only field with
**Copy request**, a link to `https://apus20.cert.fnmt.es/SolicitudCertComp/` and the steps. **Show request**
opens the same dialog from the card's data. The card's block replaces **Request a company seal** while a request
waits; the block, its buttons and the kept-seal row are hidden with the other actions when `readOnly` or not
filing (`:218`), the texts still shown.

- [ ] **Step 1: failing tests**: no request: **Request a company seal** beside **Replace certificate**; a request:
      the block with its date in the venue's zone and three buttons, no request button; **Copy request** writes
      `requestText` to the clipboard (stubbed); not filing: no buttons; a11y in both themes for the dialog's two states.
- [ ] **Step 2–4:** run the three files: FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 9: the install dialog

**Files:** create `seal-install-dialog.ts`, its `.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`, modelled on
`certificate-dialog.ts` (`draftScopeFor` `:136`, `saveActionState` `:217`, `wt-file-input`).

- [ ] **Step 1: failing tests**: Save stays quiet until a file is chosen; "Checking with AEAT…" while it works
      (`aeat_certificate.dialog.busy`); `not_from_request` is shown under the file field in the design's words;
      the other reasons reuse `strings.ts`' `aeat_certificate.refused.*`; installed closes and reloads the card;
      `fiscal.seal_request_changed` shows its message on its own line.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 10: cancel, go back, and the seal's expiry line

**Files:** modify `certificate-card.ts`, `seal-strings.ts`, `strings.ts:95-96` and `:495-496`
(`aeat_certificate.warning_sello`); tests `certificate-card.test.ts`.

- [ ] **Step 1: failing tests**: **Cancel request** asks first and **Keep request** changes nothing; the kept-seal
      row with its date and **Go back to the previous seal**, whose question says the seal installed now is kept
      when the card's installed `kind` is `sello`, else that it is not; the warning line's new words.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 11: setup's line, the guides, the docs

**Files:** `apps/setup/src/screens/cert-screen.ts:340` (one line after the intro, both modes),
`apps/setup/src/i18n/strings/venue.ts` (`:206-243`, `:485-522`); `apps/server/src/guide/en/aeat-certificate.md`
and `es/` gain `## Use a company seal {#company-seal}` / `## Usar un sello de entidad {#company-seal}`;
`docs/compliance/action-plan.md` step 2 points 2, 8 and 9 (the card makes the key; keep the seal's name and
the code); a dated pointer at `docs/compliance/getting-to-production.md:183`; delete A853 from
`docs/backlog/fiscal.md`.

- [ ] **Step 1: failing test** in `cert-screen.test.ts`: the line shows in both languages.
- [ ] **Step 2:** check against FNMT's page: open `apus20.cert.fnmt.es/SolicitudCertComp/formularioDescargaSELLO`
      and read what the download offers after «Consultar estado solicitud» if a public page shows it; write in
      the guide only what was read, dated.
- [ ] **Step 3:** implement; the guide section follows CLAUDE.md §3 (a sentence earns its place by changing what
      staff do).
- [ ] **Step 4:** run `pnpm --filter @waitron/setup exec vitest run src/screens/cert-screen.test.ts`,
      `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-box-word.test.ts`,
      `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`, and the setup and
      fiscal-verifactu `box-word` tests; expect PASS. Look at the card and both dialogs in both themes and at
      phone width (`wa-wt demo <worktree>`).
- [ ] **Step 5:** commit `-s`.

**Words, English and Spanish** (the design's English; Spanish here):

| English | Spanish |
| --- | --- |
| Request a company seal | Solicitar un sello de entidad |
| The box makes the seal's key and a request for FNMT. The key stays on this box: nobody can download it. Your current certificate keeps filing until the seal replaces it. | El servidor crea la clave del sello y una solicitud para la FNMT. La clave se queda en este servidor: nadie puede descargarla. Tu certificado actual sigue enviando los registros hasta que el sello lo sustituya. |
| Company · Tax ID · Make request | Empresa · NIF · Crear solicitud |
| Copy this request into FNMT's seal form. · Copy request · Open FNMT's form | Copia esta solicitud en el formulario de sellos de la FNMT. · Copiar solicitud · Abrir el formulario de la FNMT |
| 1. Choose «Certificado de sello de entidad», not an elliptic-curve one. 2. Give the seal a name (FNMT calls it the component name) and paste the request. 3. Sign the contract with your representative certificate. 4. Send FNMT the registry certificate it asks for. 5. Keep the seal's name and the request code FNMT emails you: you need both to download the seal. 6. Pay, download the seal and install it on this card. | 1. Elige «Certificado de sello de entidad», no uno de curva elíptica. 2. Pon un nombre al sello (la FNMT lo llama nombre del componente) y pega la solicitud. 3. Firma el contrato con tu certificado de representante. 4. Envía a la FNMT la certificación registral que pide. 5. Guarda el nombre del sello y el código de solicitud que la FNMT te envía por correo: necesitas los dos para descargar el sello. 6. Paga, descarga el sello e instálalo en esta ficha. |
| Seal request waiting for FNMT. Made {date}. | Solicitud de sello pendiente de la FNMT. Creada el {date}. |
| Keep this box's data: the seal FNMT issues works only with the key kept here. | Conserva los datos de este servidor: el sello que emita la FNMT solo funciona con la clave guardada aquí. |
| Show request · Install the issued seal · Cancel request | Ver solicitud · Instalar el sello emitido · Cancelar solicitud |
| Choose the certificate file FNMT gave you. | Elige el archivo de certificado que te dio la FNMT. |
| This certificate was not made from this box's request. Choose the seal FNMT issued for the request shown on this card. | Este certificado no se creó a partir de la solicitud de este servidor. Elige el sello que la FNMT emitió para la solicitud que aparece en esta ficha. |
| Cancel the seal request? The box deletes the key it made for it. A seal FNMT issues for this request can then never be used, and you would have to request and pay for another. · Keep request | ¿Cancelar la solicitud de sello? El servidor borra la clave que creó para ella. Un sello que la FNMT emita para esta solicitud ya no podrá usarse, y tendrías que solicitar y pagar otro. · Mantener la solicitud |
| Previous seal: valid until {date}. · Go back to the previous seal | Sello anterior: válido hasta el {date}. · Volver al sello anterior |
| Go back to the previous seal? The box checks it with AEAT first, as it does any new certificate. · The seal installed now is kept until it expires. · The certificate installed now is not kept: to use it again, install its file. · Keep current certificate · Go back | ¿Volver al sello anterior? El servidor lo comprueba antes con la AEAT, como con cualquier certificado nuevo. · El sello instalado ahora se guarda hasta que caduque. · El certificado instalado ahora no se guarda: para volver a usarlo, instala su archivo. · Mantener el certificado actual · Volver |
| This seal expires on {date}. Request a new seal on this card now: FNMT can take weeks. You sign FNMT's contract with your representative certificate, so check it is still valid. | Este sello caduca el {date}. Solicita ya un sello nuevo en esta ficha: la FNMT puede tardar semanas. Firmas el contrato de la FNMT con tu certificado de representante, así que comprueba que sigue vigente. |
| To use a company seal, finish setup with your representative certificate and request the seal afterwards on the AEAT certificate card. | Para usar un sello de entidad, termina la configuración con tu certificado de representante y solicita el sello después en la ficha del certificado de la AEAT. |

**Leaves:** the owner's ask and both answers.

## True size

By file, then three times that for production, the factor the CORRECT-FULL-INVOICE plan used
(`2026-11-25-correct-full-invoice.md`, "True size"); its receipts are Give money back's, not this item's.

| | Tasks | By file (production / test) | Expect | Generated |
| --- | --- | --- | --- | --- |
| PR 1 | 1–7 | 600 / 850 | 1,800 / 2,000 | none |
| PR 2 | 8–11 | 650 / 600 | 1,950 / 1,400 | none |

Tasks of 40 to 80 calls; split one that passes 60 unfinished (Tasks 5 and 7 are the largest).

## Review

Both PRs are fiscal (the certificate that files), permissions (`system.manage` writes), and a cross-package
contract (`FiscalCertificateSeat`): finish-branch's full wave, with two Codex reviews side by side, the second
told to set this plan's checklist aside. PR 1 also has a secret's storage. The owner lands both. Order: PR 1,
then PR 2; each leaves `main` green and working, as its "Leaves" says.

## What this plan does not do

- A request made in setup (owner's answer 1); an elliptic-curve seal; a `.p7b` file.
- Ship FNMT's certificates of its own authorities; fetch an issuing certificate from the internet.
- Download a waiting key or a kept seal: nobody can.
- Change the expiry email's words (`certificate-reminders.ts:29-54`), which name no certificate kind.
