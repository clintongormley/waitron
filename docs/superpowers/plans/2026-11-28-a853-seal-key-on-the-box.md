# A853: the box makes a company seal's key itself — implementation plan

> **Withdrawn 2026-11-28 (owner): no company seal.** "I'm abandoning seal certs, they are too
> expensive." Nothing here was built; kept as the record. See `docs/backlog/fiscal.md` →
> Decisions and deliberate limits.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: written 2026-11-28 by lane L; revised the same day after a fresh-context read
(`~/waitron-campaign-l/receipts/a853/plan-review.md`, 2 Important and 12 Minor findings, all folded in:
see "Changed after the read" at the end). For the watcher's read: D1 to D16 are lane L's own and wait
for clearance (list below the table). FISCAL: the owner lands both pull requests.

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
read. An *unreadable* entry is a stored entry this box's keys cannot open: `tryGetCredential` throws
`credentials.key_version_unknown`, `credentials.decrypt_failed` or `credentials.malformed_payload` for it
(`packages/credentials/src/store.ts:50-80`, `cipher.ts:77-81`); it never comes back empty.

## 1. Should this exist?

**The ask** (owner, 2026-11-27, `docs/backlog/fiscal.md:892-894`): "I misunderstood what the seal
certificate was for, so I think we do need one, or it'd be better to use one", then "A853 yes". A seal
cannot reach the box today without moving its key, which FNMT forbids (design, first section).
**Simplest alternative:** the owner makes the key and request on a laptop with FNMT's Windows generator
(`cert.fnmt.es/componente/generacion-claves`, read 2026-11-28), combines them into a `.p12` there and uses
today's **Replace certificate**. It needs no code, but makes the key «en una máquina del suscriptor» other
than the box and leaves a copy of the company's key on that laptop; the owner chose the box (the ask).
**Smallest build that meets the ask:** make the key and request, show it, take the `.cer`, pair it with the
key and pass it through Replace certificate's checks (Tasks 1, 2, 4, 5, 7a–7b, 8a–11). The kept seal and
**Go back** (Tasks 3's keeping, 6, 7c, 10) go beyond that minimum because the owner asked for them ("Keep it
until it expires").
**Approved, and where it is recorded:** the ask and the two answers, as the watcher relayed the owner's
words (`~/waitron-campaign-l/questions.md`, entries "WATCHER 2026-11-27 22:19" and "WATCHER 2026-11-27 23:31").
Nothing records the owner approving the design as a whole. D1 to D16 are lane L's own.

| # | Decision |
| --- | --- |
| D1 | Two new entries in the store of secrets (`packages/credentials/src/purposes.ts:10-25`): `fiscal.aeat_seal_request` = `privateKeyPem`, `requestPem`, `madeAt`; `fiscal.aeat_previous` = `pfxBase64`, `passphrase`, `certKind`, `fingerprint`, `validUntil`. No migration: `purpose` is a plain label (`packages/db/src/schema/credentials/venue-credentials.ts:17`), listed among tables with no closed vocabulary (`packages/db/src/schema/schema-conformance.test.ts:11-13`) |
| D2 | The card's read (`fiscal.view`) opens those two entries, never `fiscal.aeat`, and returns the request's text, `madeAt`, and the kept seal's expiry date. This changes `certificate-card.ts:65-66`'s "the vault entry itself is never decrypted" to "the installed certificate's entry". **Show request** is then card data, not a route. `madeAt` sits in the entry because the row's `updatedAt` moves on every re-seal (`store.ts:120-129`, called by `rotateCredentials`, `store.ts:292`). The card carries no organisation name for the kept seal: the design's row shows only its date |
| D3 | The key: RSA, 2048 bits, by `node:crypto`'s `generateKeyPair` (FNMT's key page: «Sello (RSA 2048)» for «Certificado de sello de entidad», read 2026-11-28). The request: SHA-256, subject `C=ES`, `O=<legal name>`, `organizationIdentifier=VATES-<tax ID>` from `readTaxpayer`, built by node-forge loaded with `import()` only here. FNMT's own generator asks for no subject (its manual, p. 5), so the subject decides nothing at FNMT |
| D4 | The issued file: at most `CERTIFICATE_MAX_BYTES` (`certificate-limits.ts`). **PEM first:** when the bytes contain `-----BEGIN CERTIFICATE-----`, every `CERTIFICATE` block is read, CRLF or LF; otherwise the whole file is read as one DER certificate. Never the whole file first: Node 26.13.1's `new X509Certificate` reads a PEM file holding two certificates as the first one and drops the rest (run, below). The certificate whose public key matches the waiting key (`X509Certificate.checkPrivateKey`) is the seal; every other certificate in the file goes into the `.p12` after it, as stored. No match: refused `not_from_request`. Not readable as either: `unreadable` |
| D5 | The `.p12` is written by a `writePkcs12` moved out of `rewriteOldCertificate` (`certificate-convert.ts:163-201`): raw DER certificates, so node-forge never parses FNMT's certificate (its reader drops certificates it cannot parse, `certificate-convert.ts:73-76`); key under AES-256, SHA-256 MAC. Passphrase: `randomBytes(24).toString("base64url")`, never shown. The file then goes through `openCertificate` like an uploaded one |
| D6 | One pipeline. `installCertificate`'s checks and final write (`certificate-install.ts:164-275`) become `installChecked`, which **Replace certificate**, **Install the issued seal** and **Go back** all call; each adds its own revision check and clean-up to the final write. Decision 18's two transactions stay (`certificate-install.ts:179-184`) |
| D7 | The kept seal (owner's answer 2). **Where its facts come from:** `installChecked`'s read transaction reads (decrypting only) the installed `fiscal.aeat` entry, its revision and the `fiscal.aeat_previous` entry. When the installed entry's own `certKind` is `sello` (the field filing reads, `aeat-transport.ts:39-41`, not the install row, which the command-line tool can leave behind, `packages/credentials/src/cli.ts:52`) and its revision is the body's `expectedRevision`, the file is opened with `openCertificate` **after that transaction closes** (a child process, up to 2 seconds, `certificate-open.ts:45-60`); its `fingerprint` and `validUntil` are the kept seal's. The final write's existing revision check (`certificate-install.ts:238-239`) then guarantees the entry replaced is the one opened, since every write seals under a fresh IV (`store.ts:135-136`). **The final write opens no stored entry:** it only seals and deletes. In it: if the replaced entry is such a seal and has not expired at the write's time, it becomes the kept seal, in place of any other; otherwise a kept seal that the read phase found expired at the write's time, or whose fingerprint is the new certificate's, is deleted. Replacing a representative's certificate keeps nothing new and leaves a kept seal alone |
| D8 | The kind is read from the seal's policies, as for every certificate since #4524 (`certificate-policy.ts:99-106`). An issued seal is never refused for reading as a representative's: its key exists nowhere else, so a refusal would throw away a paid seal. AEAT's live question, sent to the endpoint that kind picks, decides |
| D9 | The kept seal is deleted after expiry by the certificate reminder job's pass (`apps/server/src/certificate-reminder-worker.ts:23-48`), before its email checks, through a new seat method: hourly at most (`:57-59`), on the primary only (`:26`, `:55`). Every final write also deletes one (D7). An unreadable kept entry is left in place and the pass goes on to its emails (D11) |
| D10 | Refusals. A request revision that differs (making one while one waits, installing or cancelling one that is gone or new) throws a new `fiscal.seal_request_changed` (409), declared in `errors.ts` beside `:411-416`, mapped to 409 in `fiscal-certificate-api.ts`'s error boundary (`:39-48`), and worded in English and Spanish in `seal-strings.ts`'s code messages (Words table). A kept seal that differs from the card's throws the existing `fiscal.certificate_changed` (409). New answer reason `not_from_request`. Every write route authorises as **Replace certificate** does (`fiscal-certificate-api.ts:90-98`) |
| D11 | **An unreadable entry never stops the card, Replace certificate or the reminder job.** The card reads an unreadable `fiscal.aeat_seal_request` or `fiscal.aeat_previous` as missing, still answers the rest, and logs `warn` `fiscal.certificate_entry_unreadable` with `{ purpose, code }` only (the card's deps gain an optional `log`). The card also returns `requestRevision`, the stored request row's digest whether it opens or not, so **Make request** over an unreadable request entry replaces it (the write checks that digest again). An unreadable installed seal is replaced by Replace certificate with nothing kept; an install whose replaced seal does not open with `openCertificate` keeps nothing and goes ahead. `dropExpiredPrevious` answers "nothing deleted" for an unreadable kept entry, which stays until a seal replacement overwrites it |
| D12 | **Go back's refusals** are grouped into four sentences of their own (Words table): expired; AEAT could not be asked (`unavailable`, `unreachable`, `closed`, `aeat_fault`, `aeat_http`, `check_failed`); AEAT did not accept it (`not_accepted`, `aeat_refused`); and the box cannot use it (every other reason). Each shows on its own line above the question dialog's buttons. After "could not be asked", both buttons stay; after the other three, retrying cannot succeed, so the dialog keeps only **Keep current certificate**, which closes it and reloads the card |
| D13 | `waitron-credentials set` and `delete` refuse both new purposes, as they already refuse `email.smtp` and `backup.*` (`cli.ts:106-113`, `:189-196`), with "Use the dashboard's AEAT certificate card to request, install or cancel a company seal." Deleting the request entry would throw away a paid request's key. The usage text gains that line |
| D14 | The request is shown in a `<pre>` block, not a form field: nothing in it is edited, and the copy-failure words tell the person to select it there. No `wt-textarea` change |
| D15 | The card's new parts, in words (no picture was drawn for this item, so these sentences are what PR 2's screens are compared against; the look follows the card's existing status lines, `src/dashboard/certificate-card.ts:100-130`): see Task 8a |
| D16 | **A lost waiting key** (a restore from an older backup, a reset): the card shows no waiting block and offers **Request a company seal**; nothing on the card can name a request it no longer holds. The guide's seal section says what this means and what to do (Words table), and `not_from_request`'s words name the case for an old seal tried against a new request |

**Lane L's decisions waiting for the watcher's clearance:** D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11,
D12, D13, D14, D15, D16. None changes the owner's two answers.

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

**PEM-first receipt, run 2026-11-28** (Node 26.13.1, a script in a `mktemp -d` folder): two self-signed
certificates A then B in one PEM file, LF and CRLF. A failing case would have shown `CN=B` or a throw.
`new X509Certificate(wholeFile)` printed `CN=A` for both files, and `checkPrivateKey` matched A's key and
not B's; B saved as DER printed `CN=B` and matched B's key only (the control); B's DER bytes do not contain
`-----BEGIN CERTIFICATE-----`.

## Global Constraints

- Box is "box" in English and «servidor» in Spanish, never «equipo» (CLAUDE.md §3; the box-word guards).
- General code is English only; Spanish only in translation files and guides (CLAUDE.md §3).
- No `apps/server` file imports `@waitron/fiscal-verifactu` (`scripts/certificate-diagnosis-boundaries.test.ts:20-28`,
  `scripts/module-seams.test.ts`).
- A refusal is an answer, not a throw, except a malformed body, a refused authorisation or a changed revision
  (`certificate-install.ts:159-163`).
- A refusal on a screen says what happened and what each choice does (CLAUDE.md §3, refusals; design-system
  Forms): field refusals under the field, one message on its own line above the buttons.
- No secret in a log line or an error's params: the waiting key, the request entry, passphrases.
- No transaction is open while AEAT answers, a key is made or a `.p12` is opened (`certificate-install.ts:179-184`).
- An unreadable stored entry never stops the card, Replace certificate or the reminder job (D11).
- Every new dashboard dialog holding staged input takes `draftScopeFor` and has a `*.unsaved.test.ts`. Only
  the install dialog holds staged input (a chosen file); the request dialog and the two questions hold none.
- Product files stay under 1,000 lines: `packages/fiscal-verifactu/src/dashboard/strings.ts` is at 835, so
  the new words go in a new `seal-strings.ts`; `apps/server/src/boot.ts` is at 4,919 of its 5,000 cap
  (`scripts/product-file-size-limits.json:26`).
- Coverage `98/98/98/95` in every package touched.

## Review Focus

1. **The waiting key is lost** (restore of an older backup, a reset) and FNMT's seal arrives later: the card
   shows no waiting block and no install button, only **Request a company seal** (D16), and never crashes.
   The old seal can be tried only against a new request, where it is refused `not_from_request` with words
   naming this case. Tests: Task 5 (`not_from_request`), Task 8a (no request: no install button).
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
6. **A stored entry this box cannot open** (a request, a kept seal or an installed seal sealed under keys
   the box does not hold): the card still answers, Replace certificate still installs and keeps nothing,
   the reminder job still sends its emails (D11). Tests: Tasks 3, 4 and 7c.

---

## PR 1 — the server (packages, routes; no screen changes)

**No migration, no venue reset** (D1). Every task also runs, unedited:
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/certificate-install.test.ts src/certificate-install.concurrency.test.ts src/certificate-convert.test.ts`.

**Unreadable-entry fixture** for Tasks 3, 4 and 7c: seal the entry with `putCredential` under a ring of the
same version and another key, then read with the suite's ring, as `packages/credentials/src/store.test.ts:229-241`
does; that test and `:244-254` pin the two throws (run 2026-11-28:
`pnpm --filter @waitron/credentials exec vitest run src/store.test.ts -t "ring"`, 4 passed).

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
      `seal-issued.test.ts`: Review Focus 3's five shapes; a PEM with the authority's certificate **before**
      the seal gives both certificates and pairs the seal first (this is the case a whole-file read gets
      wrong); a certificate for another key gives `null`.
- [ ] **Step 2:** run both files with `--project node`; expect FAIL.
- [ ] **Step 3:** implement. `readIssuedFile` reads PEM blocks when the bytes contain
      `-----BEGIN CERTIFICATE-----`, otherwise one DER certificate, each through `new X509Certificate` (D4);
      never the whole PEM file in one call.
- [ ] **Step 4:** run; expect PASS.
- [ ] **Step 5:** commit `-s`.

### Task 3: one install pipeline, and the kept seal

**Files:** modify `certificate-install.ts`, `packages/credentials/src/purposes.ts` (D1), `purposes.test.ts:12-20`
(the purpose list), `packages/credentials/src/cli.ts` and `cli.test.ts` (D13, beside the `email.smtp` cases
at `cli.test.ts:544-551`); create `certificate-kept.ts`; tests: new cases in `certificate-install.test.ts`,
new `certificate-kept.test.ts`.

**Interfaces.**
- `installChecked(deps: InstallDeps, material: { pfxBase64: string; passphrase: string; expectedRevision: string | null }, now: Date, extra?: { beforeWrite?(tx: Transaction): Promise<void>; afterWrite?(tx: Transaction, personId: string): Promise<void> }): Promise<InstallAnswer>`;
  `installCertificate(deps, rawBody, now)` keeps its signature and answers.
- `readReplaced(tx: Transaction, ring: KeyRing, expectedRevision: string | null): Promise<{ seal: null | { pfxBase64: string; passphrase: string }; kept: null | "unreadable" | { fingerprint: string; validUntil: Date } }>`,
  called in `installChecked`'s read transaction (D7, D11). An unreadable `fiscal.aeat` gives `seal: null`.
- `keptFacts(seal: { pfxBase64: string; passphrase: string }): Promise<null | { fingerprint: string; validUntil: Date }>`:
  `openCertificate`, run with no transaction open; `null` when it does not open.
- `keepReplaced(tx: Transaction, ring: KeyRing, input: { replaced: null | { pfxBase64: string; passphrase: string; fingerprint: string; validUntil: Date }; kept: null | "unreadable" | { fingerprint: string; validUntil: Date }; installedFingerprint: string; at: Date; personId: string }): Promise<void>` (D7),
  called by `installChecked`'s final write before `putCredential`; it opens no entry.
- `dropExpiredPrevious(tx: Transaction, ring: KeyRing, now: Date): Promise<boolean>`: `false` for no entry, an
  unexpired one or an unreadable one.

- [ ] **Step 1: failing tests**, through `installCertificate` (the seat's install, real database): a seal replaced
      by a representative's certificate is kept with the `fingerprint` and `validUntil` of the file opened;
      a seal written straight into the store with no install row (as the command-line tool leaves it) is
      kept with its own file's facts; a representative's replaced keeps nothing and leaves an earlier kept
      seal; a second seal replaced takes the kept place; installing the kept seal's file deletes the kept
      entry; an expired kept seal is deleted by any install. **Unreadable (D11):** an installed `sello`
      entry sealed under other keys is replaced by Replace certificate, which installs and keeps nothing; a
      `sello` entry whose `.p12` does not open (bytes that are not a certificate) is replaced and nothing is
      kept; an unreadable kept entry is left by a representative's replacement and overwritten by a seal's.
      `certificate-kept.test.ts`: `dropExpiredPrevious` at, before and after `validUntil`, with no entry, and
      with an unreadable entry (`false`, entry left). `purposes.test.ts`: the two purposes and their fields.
      `cli.test.ts`: `set` and `delete` of each new purpose exit 2 with D13's words and change nothing.
- [ ] **Step 2:** run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/certificate-install.test.ts src/certificate-kept.test.ts`
      and `pnpm --filter @waitron/credentials exec vitest run src/purposes.test.ts src/cli.test.ts`; expect FAIL.
- [ ] **Step 3:** implement; `certificate-install.test.ts`'s existing cases pass unedited.
- [ ] **Step 4:** run Step 2's files and the guards the new purposes reach, unedited:
      `pnpm --filter @waitron/credentials exec vitest run src/backup-verification.test.ts src/rotate.test.ts`,
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/backup-verification.test.ts src/backup-verification-secrets.test.ts`,
      `pnpm --filter @waitron/composition exec vitest run src/credentials-backup-verification.test.ts src/backup-verification.inventory.test.ts`,
      `pnpm --filter @waitron/server exec vitest run src/backup-verification-target.test.ts`.
      **What the backup check changes** (read, not run): the credentials backup policy lists every purpose
      (`packages/credentials/src/backup-verification.ts:24`), so its list grows by two; a release without them
      refuses such a backup `unsupported` (`:62`). The list also feeds the credentials module's policy
      digest (`apps/server/src/backup-verification-target.ts:36-50`, `[...p.secrets].sort()`), so every
      stored backup verification target changes. `backup-verification-target.test.ts`'s pinned digests are of
      its own test module (`:54-61`), so it is expected to pass unedited. Pre-live, acceptable; the PR says
      both.
- [ ] **Step 5:** commit `-s`.

### Task 4: make, show and cancel a request

**Files:** create `seal-request-store.ts` (the three operations); modify `certificate-card.ts` (D2, D11),
`errors.ts` (`fiscal.seal_request_changed`, beside `:411-416`). Callers the card's new required `ring`
breaks, each passed the suite's ring: `certificate-card.test.ts` (`depsFor`, `:46-56`; whole-card `toEqual`s
at `:109`, `:126` and `:141` gain the new fields), `slot.test.ts:446-455` (deps and its whole-card `toEqual`),
`drain.certificate-refused.test.ts:238`. The seat contract's `read` deps type
(`packages/fiscal/src/contribution.ts:99-107`) and the route that calls it
(`apps/server/src/fiscal-certificate-api.ts:60-71`) change in Task 7a; until then `slot.ts:138` passes the
seat's deps through, so this task makes `ring` optional on `CertificateCardDeps` and Task 7a makes it
required. `apps/server/src/boot.certificate-diagnosis.test.ts:31-36` copies `read` by reference and needs no
change. Vitest does not typecheck, so these show only at the pre-push hook's typecheck: run
`pnpm --filter @waitron/fiscal-verifactu typecheck` in Step 4.

**Interfaces.**
- `makeSealRequestEntry(deps: Pick<InstallDeps, "db" | "ring" | "authorize" | "log">, body: unknown, now: Date): Promise<{ revision: string }>`;
  body `{ expectedRequestRevision: string | null }`. Read transaction: authorise, taxpayer, the stored row's
  revision must be the body's and the entry must not open as a request (none, or unreadable: D11);
  `makeSealRequest` with no transaction open; write transaction: authorise, revision still the body's,
  `putCredential`.
- `cancelSealRequest(deps, body: { expectedRequestRevision: string }): Promise<void>`: one transaction, `deleteCredential`.
- `CertificateCard` gains `requestRevision: string | null` (the request row's digest, readable or not),
  `sealRequest: null | { madeAt: string; request: string }` (null when absent or unreadable), and
  `previous: null | { revision: string; validUntil: string }` (null when absent, unreadable, or once
  `validUntil` has passed). `CertificateCardDeps` gains `ring?: KeyRing` (required from Task 7a) and
  `log?: FiscalDutyLog`.

- [ ] **Step 1: failing tests**: a request made, read on the card with its `madeAt` and text; a second make
      throws `fiscal.seal_request_changed` and leaves the first; cancel with a stale revision throws it and
      deletes nothing; cancel deletes and writes `credentials.removed` with the person (`store.ts:196-212`); a
      refused authorisation before and after the key is made writes nothing; the log fields of a make hold no
      `-----BEGIN` text; the card shows a kept seal until its `validUntil` and not after. **Unreadable
      (D11):** with an unreadable request entry the card answers `sealRequest: null` with a non-null
      `requestRevision` and the installed certificate's facts unchanged, logs `fiscal.certificate_entry_unreadable`
      with only `purpose` and `code`, and a make sent that revision replaces the entry; with an unreadable
      kept entry the card answers `previous: null`.
- [ ] **Step 2:** run `--project node src/seal-request-store.test.ts src/certificate-card.test.ts`; expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run; expect PASS. Also `src/slot.test.ts` and `src/drain.certificate-refused.test.ts`, and
      `pnpm --filter @waitron/fiscal-verifactu typecheck`.
- [ ] **Step 5:** commit `-s`.

### Task 5: install the issued seal

**Files:** create `seal-install.ts`; test `seal-install.test.ts`; `CERTIFICATE_REFUSAL_REASONS`
(`certificate-install.ts:22-40`) gains `not_from_request`.

**Interfaces.** `installIssuedSeal(deps: InstallDeps, body: unknown, now: Date): Promise<InstallAnswer>`; body
`{ certificateBase64: string; expectedRevision: string | null; expectedRequestRevision: string }`. Read
transaction: the request entry (missing, unreadable or other revision: `fiscal.seal_request_changed`). Then
`readIssuedFile`, `pairWithKey`, `writePkcs12`, and `installChecked` with `beforeWrite` checking the request
revision again and `afterWrite` deleting the request entry.

- [ ] **Step 1: failing tests**, the AEAT question answered by `startAnsweringServer`
      (`test/certificate-fixtures.ts:270`): an issued seal installs, the card shows it as `sello`, filing's reader
      (`aeat-transport.ts:62-64`) opens it, the request is gone, and the representative's certificate it replaced
      is not kept; a seal for another key is `not_from_request` (Review Focus 1); AEAT's fault leaves the request
      and the installed certificate (Review Focus 4); a cancel landing while AEAT answers makes the write throw
      `fiscal.seal_request_changed` with nothing written (Review Focus 2, held by a transport that waits for a
      signal, as `certificate-install.concurrency.test.ts` does); an issued certificate with no seal policy installs
      as `representante` (D8); a seal naming another tax ID is `other_taxpayer`; an expired one `expired`; a
      `.p12` file is `unreadable`.
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
      Focus 5); a stale `expectedPreviousRevision` throws `fiscal.certificate_changed`; an unreadable kept entry
      throws `fiscal.certificate_changed` (the card offered none); AEAT refusing leaves both.
- [ ] **Step 2–4:** run `--project node src/seal-install.test.ts`: FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 7a: the seat

**Files:** modify `packages/fiscal/src/contribution.ts` (`:87-140`), `packages/fiscal-verifactu/src/slot.ts`
(`:127-142`), `certificate-card.ts` (`ring` required); tests `packages/fiscal/src/certificate-diagnosis-contract.test.ts`
(a seat with no `seal` still satisfies the type), `slot.test.ts` (the slot exposes the new members).

**Interfaces.** `FiscalCertificateSeat.read`'s deps gain `ring` and an optional `log`. New optional seat
members, each `(deps, body, now)` as `install` is: `seal?: { request; cancel; install; restorePrevious }`, and
`dropExpiredPrevious?(tx: Transaction, ring: KeyRing, now: Date): Promise<boolean>`. Because they are
optional, the fake seats in `apps/server` tests keep compiling.

- [ ] **Step 1: failing tests** as listed; **Step 2:** run
      `pnpm --filter @waitron/fiscal exec vitest run src/certificate-diagnosis-contract.test.ts` and
      `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/slot.test.ts`; expect FAIL.
- [ ] **Step 3:** implement; `apps/server/src/fiscal-certificate-api.ts:60-71` passes `deps.ring` and its `log`
      to `read`.
- [ ] **Step 4:** run Step 2's files and `pnpm --filter @waitron/fiscal typecheck`,
      `pnpm --filter @waitron/fiscal-verifactu typecheck`, `pnpm --filter @waitron/server typecheck`; expect PASS.
- [ ] **Step 5:** commit `-s`.

### Task 7b: the routes

**Files:** modify `apps/server/src/fiscal-certificate-api.ts`; tests `fiscal-certificate-api.test.ts` (fake
seat), `fiscal-certificate-api.verifactu.test.ts` (real seat).

Routes, mounted only when `seal` is present, each with the install's authorise and the error boundary
(`:39-48`) gaining `fiscal.seal_request_changed: 409`:

| Route | Body | Answer |
| --- | --- | --- |
| `POST /management-api/fiscal-certificate/seal-request` | `{ expectedRequestRevision }` | `{ revision }` |
| `POST …/seal-request/cancel` | `{ expectedRequestRevision }` | `{}` |
| `POST …/seal-request/install` | `{ certificateBase64, expectedRevision, expectedRequestRevision }`, the install's `bodyLimit` | the install's answer |
| `POST …/previous` | `{ expectedRevision, expectedPreviousRevision }` | the install's answer |

- [ ] **Step 1: failing tests**: each route refuses without `system.manage` (403), without a recent sign-in, and
      on a box that does not file (409 `fiscal.certificate_not_used`); a changed request answers 409
      `fiscal.seal_request_changed`; the real seat's routes carry one request from make to install; the
      GET answer carries `requestRevision`, `sealRequest` and `previous` to a `fiscal.view` holder.
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/fiscal-certificate-api.test.ts src/fiscal-certificate-api.verifactu.test.ts`; expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run Step 2's files and the root guards
      `pnpm exec vitest run scripts/certificate-diagnosis-boundaries.test.ts scripts/module-seams.test.ts scripts/errors-reachable.test.ts`; expect PASS.
- [ ] **Step 5:** commit `-s`.

### Task 7c: the reminder job deletes an expired kept seal

**Files:** modify `apps/server/src/certificate-reminder-worker.ts` (deps gain `ring`; `seat` picks
`dropExpiredPrevious` too), `apps/server/src/boot.ts:3028-3043` (passes `ring`; one line);
test `certificate-reminder-worker.test.ts`.

The pass calls `dropExpiredPrevious` in its own transaction after `active()` (`:26-27`) and before
`resolveDelivery` (`:28`), so a box with no email still deletes.

- [ ] **Step 1: failing tests**: the job deletes an expired kept seal with email unconfigured, and not on a
      non-primary; with an unreadable kept entry it deletes nothing and still queues the reminder emails (D11).
- [ ] **Step 2:** run `pnpm --filter @waitron/server exec vitest run src/certificate-reminder-worker.test.ts`; expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run Step 2's file, `src/boot.certificate-reminders.test.ts`, and
      `pnpm exec vitest run scripts/product-file-size.test.ts`; expect PASS.
- [ ] **Step 5:** update `docs/backlog/fiscal.md`'s A853 entry: the server is built, the screens are PR 2.
      Commit `-s`.

**Leaves:** the box can do it all, and no screen offers it.

## PR 2 — the card, the setup line and the guides

**No migration, no venue reset.** Browser tests run with
`pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser <files>`.

### Task 8a: the words, the client and the card's new parts

**Files:** create `src/dashboard/seal-strings.ts` (`SEAL_STRINGS`, its own `registerCatalogue`, as
`strings.ts:802-804`; `es` typed `Record<SealKey, string>` as `strings.ts:399`, so a missing Spanish line
fails the typecheck; and `SEAL_CODE_MESSAGES` with `fiscal.seal_request_changed` through `registerCodeMessages`,
as `strings.ts:806-825`); modify `src/dashboard/client.ts` (the card view's new fields; `requestSeal`,
`cancelSealRequest`, `installIssuedSeal`, `restorePreviousSeal`), `certificate-card.ts` (`#action`, `:217-232`,
and `#body`), `src/dashboard/box-word.test.ts` (its `texts()` reads `SEAL_STRINGS` and `SEAL_CODE_MESSAGES`;
"reads every table" gains a key from each); tests `certificate-card.test.ts`, `certificate-card.a11y.test.ts`.

**The card's new parts, in words (D15).** The card's look today: a bordered section, a header row with the
title and its buttons, any expiry status line (a box with a 1px coloured border, `--wt-radius-md` corners and
a coloured dot before the text, no icon), then the certificate's rows as a two-column list.
- **Request a company seal**: a secondary `wt-button` in the header's buttons, after **Replace certificate**
  (or **Install certificate**) and before **Diagnose connection**. It is not shown while a request waits.
- **The waiting block**: directly below the expiry status line, or below the header when there is none, and
  above the certificate's rows, as the design says ("a block above the current certificate's rows"). Drawn
  like a status line: one box, 1px `--wt-color-border` line, `--wt-radius-md` corners, `--wt-space-3`
  padding, a dot filled with `--wt-color-primary` before the first line, no icon. First line, normal text:
  "Seal request waiting for FNMT. Made {date}." (the venue's zone). Second line, muted text
  (`--wt-color-text-muted`): "Keep this box's data: the seal FNMT issues works only with the key kept here."
  Below them, a wrapping row of secondary buttons: **Show request**, **Install the issued seal**, **Cancel
  request**.
- **The kept-seal row**: the last row of the certificate's rows, label "Previous seal", value "Valid until
  {date}", and under that value, in the same cell, a secondary **Go back to the previous seal** button.
- **Who sees what** (design, "Who may do what"): a box that does not file shows none of this. On a card
  read without write rights (`readOnly`), the waiting block and the kept-seal row show their text, and
  **Show request** stays; **Request a company seal**, **Install the issued seal**, **Cancel request** and
  **Go back** are hidden.

- [ ] **Step 1: failing tests**: no request: **Request a company seal** beside **Replace certificate**; a request:
      the block above the rows with its date in the venue's zone and three buttons, no request button; no
      request on the card (as after a lost key): no install button anywhere (Review Focus 1); read-only:
      the block with **Show request** only, the kept-seal row with no button; not filing: none of it; a
      kept seal: the row with its date; a11y in both themes for the block and the row; `box-word.test.ts`
      reads the new tables.
- [ ] **Step 2–4:** run `--project browser src/dashboard/certificate-card.test.ts src/dashboard/certificate-card.a11y.test.ts`
      and `--project node src/dashboard/box-word.test.ts` (or the project that runs it today): FAIL, implement,
      PASS.
- [ ] **Step 5:** commit `-s`.

### Task 8b: the request dialog

**Files:** create `seal-request-dialog.ts`; tests `seal-request-dialog.test.ts`, `.a11y.test.ts`.

The dialog shows the design's words; after **Make request** it shows the request in a `<pre>` block (D14:
`--wt-font-family-mono`, `--wt-color-surface-sunken` behind it, 1px `--wt-color-border`, `--wt-radius-md`,
wrapping, selectable, scrolling past a fixed height) with **Copy request**, a link to
`https://apus20.cert.fnmt.es/SolicitudCertComp/` and the steps. **Show request** opens the same dialog in
that second state from the card's data, for anyone who sees the card. **Copy request** answers on a line
below it: "Request copied." or, when the browser refuses (the clipboard needs a secure page), "The browser
could not copy the request. Select the request above and copy it." (as `certificate-diagnosis.ts:167-181`
does). `fiscal.seal_request_changed` from **Make request** shows its message on its own line above the buttons.

- [ ] **Step 1: failing tests**: **Make request** shows the request and the steps; **Copy request** writes
      `requestText` to the clipboard (stubbed) and shows "Request copied."; a clipboard that throws shows the
      failure words; `fiscal.seal_request_changed` shows its words; **Show request** opens with no **Make
      request**; a11y in both themes for the dialog's two states.
- [ ] **Step 2–4:** run the two files: FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 9: the install dialog

**Files:** create `seal-install-dialog.ts`, its `.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`, modelled on
`certificate-dialog.ts` (`draftScopeFor` `:136`, `saveActionState` `:217`, `wt-file-input` with `required`
`:336-338`, so the field carries the required mark), accepting `.cer,.crt,.pem`.

Refusals (Words table): `unreadable` gets the seal dialog's own words, which name FNMT's `.cer` and not a
`.pfx`; `not_from_request` its own; the other reasons reuse `strings.ts`' `aeat_certificate.refused.*`,
whose advice ("choose another certificate", "Cancel to stop") fits this dialog. All of them show under the
file field. `fiscal.seal_request_changed` shows on its own line above the buttons.

- [ ] **Step 1: failing tests**: the file field is marked required; Save stays quiet until a file is chosen;
      "Checking with AEAT…" while it works (`aeat_certificate.dialog.busy`); `unreadable` shows the seal
      dialog's words, not "Choose the .pfx or .p12 file."; `not_from_request` shows its words under the file
      field; another reason reuses `aeat_certificate.refused.*`; installed closes and reloads the card;
      `fiscal.seal_request_changed` shows its message on its own line.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 10: cancel, go back, and the seal's expiry line

**Files:** modify `certificate-card.ts`, `seal-strings.ts`, `strings.ts:95-96` and `:495-496`
(`aeat_certificate.warning_sello`), `src/dashboard/certificate-card.ts:36-49` (`statusLine` picks the waiting variant when
`sealRequest !== null`); tests `certificate-card.test.ts`.

Both questions are `wt-dialog`s. A refusal shows on its own line above their buttons. **Cancel request**'s
only refusal is `fiscal.seal_request_changed`. **Go back**'s are D12's four, plus `fiscal.certificate_changed`.

- [ ] **Step 1: failing tests**: **Cancel request** asks first and **Keep request** changes nothing; a changed
      request shows `fiscal.seal_request_changed`'s words in the question; the kept-seal row's **Go back to the
      previous seal**, whose question says the seal installed now is kept when the card's installed `kind` is
      `sello`, else that it is not; Go back refused `expired`, `unreachable`, `aeat_refused` and `unreadable`
      shows each group's words, with both buttons only after `unreachable`; the warning line's new words, and
      the waiting variant (no "Request a new seal") while a request waits.
- [ ] **Step 2–4:** FAIL, implement, PASS.
- [ ] **Step 5:** commit `-s`.

### Task 11: setup's line, the guides, the docs

**Files:** `apps/setup/src/screens/cert-screen.ts:340` (one line after the intro, both modes),
`apps/setup/src/i18n/strings/venue.ts` (`:206-243`, `:485-522`); `apps/server/src/guide/en/aeat-certificate.md`
and `es/` gain `## Use a company seal {#company-seal}` / `## Usar un sello de entidad {#company-seal}`, including
the lost-key sentence (Words table, D16); `docs/compliance/action-plan.md` step 2 points 2, 8 and 9 (the card
makes the key; keep the seal's name and the code); a dated pointer at
`docs/compliance/getting-to-production.md:183`; delete A853 from `docs/backlog/fiscal.md`.

- [ ] **Step 1: failing test** in `cert-screen.test.ts`: the line shows in both languages.
- [ ] **Step 2:** check against FNMT's page: open `apus20.cert.fnmt.es/SolicitudCertComp/formularioDescargaSELLO`
      and read what the download offers after «Consultar estado solicitud» if a public page shows it; write in
      the guide only what was read, dated.
- [ ] **Step 3:** implement; the guide section follows CLAUDE.md §3 (a sentence earns its place by changing what
      staff do).
- [ ] **Step 4:** run `pnpm --filter @waitron/setup exec vitest run src/screens/cert-screen.test.ts src/i18n/box-word.test.ts`
      (the setup guard reads `strings.ts`, which spreads `venue.ts`, `strings.ts:6,21,40`),
      `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-box-word.test.ts`,
      `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`, and the
      fiscal-verifactu `box-word` test; expect PASS. Look at the card and all four dialogs in both themes and
      at phone width (`wa-wt demo <worktree>`), against Task 8a's words.
- [ ] **Step 5:** commit `-s`.

**Words, English and Spanish** (the design's English; Spanish here):

| English | Spanish |
| --- | --- |
| Request a company seal | Solicitar un sello de entidad |
| The box makes the seal's key and a request for FNMT. The key stays on this box: nobody can download it. Your current certificate keeps filing until the seal replaces it. | El servidor crea la clave del sello y una solicitud para la FNMT. La clave se queda en este servidor: nadie puede descargarla. Tu certificado actual sigue enviando los registros hasta que el sello lo sustituya. |
| Company · Tax ID · Make request | Empresa · NIF · Crear solicitud |
| Copy this request into FNMT's seal form. · Copy request · Open FNMT's form | Copia esta solicitud en el formulario de sellos de la FNMT. · Copiar solicitud · Abrir el formulario de la FNMT |
| Request copied. | Solicitud copiada. |
| The browser could not copy the request. Select the request above and copy it. | El navegador no ha podido copiar la solicitud. Selecciona la solicitud de arriba y cópiala. |
| 1. Choose «Certificado de sello de entidad», not an elliptic-curve one. 2. Give the seal a name (FNMT calls it the component name) and paste the request. 3. Sign the contract with your representative certificate. 4. Send FNMT the registry certificate it asks for. 5. Keep the seal's name and the request code FNMT emails you: you need both to download the seal. 6. Pay, download the seal and install it on this card. | 1. Elige «Certificado de sello de entidad», no uno de curva elíptica. 2. Pon un nombre al sello (la FNMT lo llama nombre del componente) y pega la solicitud. 3. Firma el contrato con tu certificado de representante. 4. Envía a la FNMT la certificación registral que pide. 5. Guarda el nombre del sello y el código de solicitud que la FNMT te envía por correo: necesitas los dos para descargar el sello. 6. Paga, descarga el sello e instálalo en esta ficha. |
| Seal request waiting for FNMT. Made {date}. | Solicitud de sello pendiente de la FNMT. Creada el {date}. |
| Keep this box's data: the seal FNMT issues works only with the key kept here. | Conserva los datos de este servidor: el sello que emita la FNMT solo funciona con la clave guardada aquí. |
| Show request · Install the issued seal · Cancel request | Ver solicitud · Instalar el sello emitido · Cancelar solicitud |
| Choose the certificate file FNMT gave you. | Elige el archivo de certificado que te dio la FNMT. |
| *(install refusal, `unreadable`)* Waitron cannot read this file as a certificate. Choose the .cer file you downloaded from FNMT for this request, not a .pfx or .p12 file. | Waitron no puede leer este archivo como certificado. Elige el archivo .cer que descargaste de la FNMT para esta solicitud, no un archivo .pfx o .p12. |
| *(install refusal, `not_from_request`)* This certificate was not made from the request shown on this card. Choose the seal FNMT issued for that request. A seal FNMT issued for an earlier request works only while the box still holds that request's key: after restoring an older backup it does not, and that seal can never be used. | Este certificado no se creó a partir de la solicitud que aparece en esta ficha. Elige el sello que la FNMT emitió para esa solicitud. Un sello que la FNMT emitió para una solicitud anterior solo funciona mientras el servidor conserve la clave de esa solicitud: tras restaurar una copia de seguridad más antigua no la conserva, y ese sello ya no podrá usarse. |
| *(`fiscal.seal_request_changed`)* Someone else changed the seal request meanwhile. Close this window to see it. | Otra persona ha cambiado la solicitud de sello mientras tanto. Cierra esta ventana para verla. |
| Cancel the seal request? The box deletes the key it made for it. A seal FNMT issues for this request can then never be used, and you would have to request and pay for another. · Keep request | ¿Cancelar la solicitud de sello? El servidor borra la clave que creó para ella. Un sello que la FNMT emita para esta solicitud ya no podrá usarse, y tendrías que solicitar y pagar otro. · Mantener la solicitud |
| Previous seal · Valid until {date} · Go back to the previous seal | Sello anterior · Válido hasta el {date} · Volver al sello anterior |
| Go back to the previous seal? The box checks it with AEAT first, as it does any new certificate. · The seal installed now is kept until it expires. · The certificate installed now is not kept: to use it again, install its file. · Keep current certificate · Go back | ¿Volver al sello anterior? El servidor lo comprueba antes con la AEAT, como con cualquier certificado nuevo. · El sello instalado ahora se guarda hasta que caduque. · El certificado instalado ahora no se guarda: para volver a usarlo, instala su archivo. · Mantener el certificado actual · Volver |
| *(Go back refused, expired)* The previous seal expired on {date}, so the box cannot go back to it. The current certificate is unchanged. Keep current certificate closes this window. | El sello anterior caducó el {date}, así que el servidor no puede volver a él. El certificado actual no cambia. Mantener el certificado actual cierra esta ventana. |
| *(Go back refused, AEAT could not be asked)* The box could not check the previous seal with AEAT, so nothing changed: the current certificate is unchanged. Check the internet connection, then select Go back to try again, or Keep current certificate to close this window. | El servidor no ha podido comprobar el sello anterior con la AEAT, así que no ha cambiado nada: el certificado actual sigue igual. Comprueba la conexión a internet y selecciona Volver para intentarlo de nuevo, o Mantener el certificado actual para cerrar esta ventana. |
| *(Go back refused, AEAT did not accept it)* AEAT did not accept the previous seal, so the box cannot go back to it. It may have been revoked. The current certificate is unchanged. Keep current certificate closes this window. | La AEAT no ha aceptado el sello anterior, así que el servidor no puede volver a él. Puede que se haya revocado. El certificado actual no cambia. Mantener el certificado actual cierra esta ventana. |
| *(Go back refused, any other reason)* The box cannot use the previous seal it kept, so it cannot go back to it. The current certificate is unchanged. Keep current certificate closes this window. | El servidor no puede usar el sello anterior que guardaba, así que no puede volver a él. El certificado actual no cambia. Mantener el certificado actual cierra esta ventana. |
| This seal expires on {date}. Request a new seal on this card now: FNMT can take weeks. You sign FNMT's contract with your representative certificate, so check it is still valid. | Este sello caduca el {date}. Solicita ya un sello nuevo en esta ficha: la FNMT puede tardar semanas. Firmas el contrato de la FNMT con tu certificado de representante, así que comprueba que sigue vigente. |
| *(the same, while a request waits)* This seal expires on {date}. Your seal request is waiting for FNMT: install the new seal on this card when FNMT issues it. | Este sello caduca el {date}. Tu solicitud de sello está pendiente de la FNMT: instala el sello nuevo en esta ficha cuando la FNMT lo emita. |
| To use a company seal, finish setup with your representative certificate and request the seal afterwards on the AEAT certificate card. | Para usar un sello de entidad, termina la configuración con tu certificado de representante y solicita el sello después en la ficha del certificado de la AEAT. |
| *(guide, lost key)* If FNMT issues a seal but the card shows no waiting request, for example because the box was restored from an older backup, the box no longer holds that seal's key and the seal cannot be used. Request a new seal. | Si la FNMT emite un sello pero la ficha no muestra ninguna solicitud pendiente, por ejemplo porque el servidor se restauró desde una copia de seguridad más antigua, el servidor ya no conserva la clave de ese sello y el sello no puede usarse. Solicita un sello nuevo. |

**Leaves:** the owner's ask and both answers.

## True size

**An estimate, by file**, from the size of the file each new one is modelled on (line counts read with
`wc -l` at the base); nothing here was measured from this item's own code. Expect about ±30%.

| | Production | Tests | Generated |
| --- | --- | --- | --- |
| PR 1 (Tasks 1–7c) | about 900 | about 1,900 | none |
| PR 2 (Tasks 8a–11) | about 1,000, plus about 60 guide lines | about 1,200 | none |

How the figures are built:
- **PR 1 production:** `writePkcs12` +25 net (moved, not new); `seal-request.ts` and `seal-issued.ts` about
  70 each; `certificate-install.ts` +60 (the read phase and the split; today 275); `certificate-kept.ts` 90;
  `purposes.ts` and `cli.ts` +25; `seal-request-store.ts` 120; `certificate-card.ts` +70 (today 106);
  `errors.ts` +8; `seal-install.ts` 160 (two flows, each shorter than `installCertificate`'s 112 lines);
  `contribution.ts` +40, `slot.ts` +15; the four routes +110 (today's install route is about 30 lines,
  `fiscal-certificate-api.ts:74-103`); the reminder job and `boot.ts` +17.
- **PR 1 tests:** new install, kept and unreadable cases +350 (`certificate-install.test.ts` is 777 for one
  flow); `seal-install.test.ts` 450; `seal-issued.test.ts` 150; `seal-request.test.ts` and
  `certificate-pkcs12.test.ts` 160; `seal-request-store.test.ts` 200; card cases +120; route tests +370 (the
  two API test files are 417 and 294); credentials and reminder cases +100.
- **PR 2 production:** `seal-strings.ts` 220 (about 35 keys in two languages, many long); `seal-request-dialog.ts`
  250 and `seal-install-dialog.ts` 300 (`certificate-dialog.ts`, with a passphrase field this one lacks, is
  431); `certificate-card.ts` +170 (today 405); `client.ts` +50; setup +10.
- **PR 2 tests:** install dialog tests 650 (`certificate-dialog.test.ts` 896, its a11y 151, unsaved 212);
  request dialog 300; card cases +250 (today 381).

Every task is written to fit well under 100 implementer calls; the largest are Tasks 3, 5 and 9. An
implementer past about 150 calls stops and hands over, as `subagent_type: "implementer"` already carries.

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
- Repair an unreadable entry: the card and installs work around it (D11); a new seal replacement overwrites a
  kept one, and a new request replaces a request one.

## Changed after the read

The fresh-context read (`~/waitron-campaign-l/receipts/a853/plan-review.md`) and what each finding changed.
Each was checked against the code at `e2eac48b7a` before writing; what was run is named.

- **I1, unreadable entries block the card and Replace certificate.** Agreed: `tryGetCredential` throws for a
  row that does not open (`store.ts:50-80`), pinned by `store.test.ts:229-254` (run, 4 passed). New D11; D7
  now says the kept seal's fingerprint and expiry come from opening the replaced entry's file after the read
  transaction, with the final write's revision check guaranteeing it is the same entry and the write opening
  nothing; nothing is kept when it does not open. Also found while checking: an unreadable kept entry would
  have made `dropExpiredPrevious` throw and stop the reminder emails, and an unreadable request entry would
  have left **Make request** refused for ever; both handled in D11 (`requestRevision` on the card). Tests in
  Tasks 3, 4, 6 and 7c; Review Focus 6.
- **I2, refusal words.** Added to the Words table: the seal dialog's own `unreadable` (FNMT's `.cer`, not a
  `.pfx`), `fiscal.seal_request_changed` in English and Spanish (registered in `SEAL_CODE_MESSAGES`, declared
  in `errors.ts`, mapped 409), Copy request's two lines, and Go back's four refusal groups (D12), each saying
  the current certificate is unchanged and what each button does. Where each shows is in Tasks 8b, 9 and 10.
  The install dialog's file field carries the required mark (Task 9).
- **Minor 1, Show request hidden on a read-only card.** Fixed: read-only keeps the block's text and **Show
  request**; only the write buttons hide (Task 8a).
- **Minor 2, the expiry warning while a request waits.** Fixed: a waiting variant without "Request a new seal"
  (Words table; Task 10 test).
- **Minor 3, the kept seal's organisation.** Cut: the design's row (design, "Words on the screens") shows
  only the date, and nothing else reads it.
- **Minor 4, PEM first.** Fixed in D4 and Task 2, and the experiment re-run here (PEM-first receipt above).
- **Minor 5, callers Task 4 breaks.** Listed in Task 4, checked by `rg`: `certificate-card.test.ts`'s three
  whole-card `toEqual`s and `depsFor`, `slot.test.ts:446-455`, `drain.certificate-refused.test.ts:238`, the
  contract's `read` type and the route. One correction to the read: `boot.certificate-diagnosis.test.ts:31-36`
  copies `read` by reference and does not call it, so it needs no change. `ring` is optional until Task 7a so
  each task typechecks.
- **Minor 6, the guards cannot see the new words.** Task 8a adds both new tables to
  `packages/fiscal-verifactu/src/dashboard/box-word.test.ts`. One correction to the read:
  `strings.test.ts` holds no English–Spanish parity check; parity comes from typing `es` as
  `Record<Key, string>` (`strings.ts:399`), which `seal-strings.ts` copies, so the typecheck catches a
  missing line. The setup line is read by `apps/setup/src/i18n/box-word.test.ts` through `strings.ts`'s
  spread of `venue.ts`, and the guides by `apps/server/src/guide-box-word.test.ts`; both run in Task 11.
- **Minor 7, Task 7 too big.** Split into 7a (seat), 7b (routes) and 7c (job); Task 8 also split, into 8a
  (words, client, card parts) and 8b (request dialog).
- **Minor 8, a lost waiting key.** New D16: Review Focus 1 corrected (no install button without a request),
  `not_from_request`'s words name the case, and the guide's seal section says what to do.
- **Minor 9, the backup check.** Line corrected to `:62`; the policy digest change added, with
  `backup-verification-target.test.ts` in Task 3 Step 4 (its pinned digests are its own test module's, read
  at `:54-61`). The PR says both.
- **Minor 10, the command-line tool.** New D13: `set` and `delete` refuse both new purposes, as they refuse
  `email.smtp` and `backup.*` today; chosen over a usage line alone because the siblings refuse.
- **Minor 11, the size factor.** Replaced by a by-file estimate from the comparable files' sizes, stated as an
  estimate.
- **Minor 12, the card's look.** New D15 and Task 8a give the request button, the waiting block and the
  kept-seal row in words (position, border, dot, colours, no icons). No mock-up was drawn for this item.
  The design's two sentences do not conflict: the block sits above the rows, and the header button is not
  shown while it does.
- **Noted, no change:** a revoked kept seal stays offered until it expires and Go back is refused by AEAT
  (the owner's "keep until it expires"; D12's "did not accept" words cover it); an issuing certificate AEAT
  might need stays an open point above.
