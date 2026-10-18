# A795 — Installing or renewing the AEAT certificate after setup — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (each task
> to one `subagent_type: "implementer"`, then its reviewer where the task says so). Steps use
> checkbox (`- [ ]`) syntax. Read `superpowers:test-driven-development` before writing code. An
> implementer that passes about 150 tool calls with its task unfinished stops at a passing (or
> cleanly red) point, commits, and returns a handover: done, left, files, each check's state.

**Goal:** a card on Venue settings → Venue details shows the box's AEAT certificate, and a manager
can install or replace it there after setup: the box opens the file, checks it, asks AEAT a
read-only question with it, and only then replaces the old one; expiry raises dashboard alerts and
emails.

**Architecture:** everything that knows what a PKCS#12 file or AEAT is lives in
`@waitron/fiscal-verifactu`, reached by the host through a new `certificate` seat on
`FiscalContribution` (`packages/fiscal/src/contribution.ts`), the way setup's
`provisioningSecret` seat already is. `apps/server` mounts two routes, one ongoing-alert source and
one email loop over that seat. The dashboard card and dialog are a settings panel contributed by
the Veri*Factu module through `@waitron/dashboard-modules`. Two new `local` tables in the module's
own migration set record every install (append-only) and every reminder email.

**Tech stack:** TypeScript, Hono, drizzle on `node:sqlite`, `node:tls`/`node:crypto`, undici,
`@waitron/verifactu` 0.2.1's `createClient().consultar`, Lit, `wt-*` primitives, Vitest (Node and
real Chromium), node-forge for test certificates.

**Spec:** [2026-10-18-a795-aeat-certificate-after-setup-design.md](../specs/2026-10-18-a795-aeat-certificate-after-setup-design.md)
(read all of it; §3, §5, §7 and §8 are what the tasks implement). Mockups:
[`docs/backlog/mockups/a795-aeat-certificate/`](../../backlog/mockups/a795-aeat-certificate/).

Worktree: `/Users/clintongormley/workspace/worktrees/waitron-feat-a795-aeat-certificate-after-setup`,
branch `feat/a795-aeat-certificate-after-setup`, cut from `main` at `79c190c98`.

---

## 0. Fiscal core: untouched

Nothing in this plan changes `computeHuella`, the chain (`chain.ts`, `cadenas`), invoice-number
allocation, `registros_facturacion`, `recordSale`, `recordCorrection`, `recordSubstitution`,
`registerSif` or `restoreFiscal`, and no task calls any of them. `drain.ts`, `envios` and
`apps/server/src/pass.ts` are not changed either (design §6). The one fiscal-verifactu file the
build edits that setup already uses is `provisioning-secret.ts` (the seal also writes an install
record, Task 3). Tasks 2 and 3 run the golden huella test and the `inmutabilidad` suite UNEDITED; if
either needs an edit to pass, STOP and report — that is not a test to fix.

## 1. Owner answers (2026-10-18), all as recommended

- **Q1:** replacing the certificate needs the EXISTING `system.manage` (managers and admins). No new
  permission; design §6's "Q1 = B only" row (`fiscal.configure`) is NOT built.
- **Q2:** thresholds by type, in calendar days left (design §5.4): a company seal (`sello`) amber
  from 90, red from 30; a representative certificate (`representante`) amber from 60, red from 14.
- **Q3:** yes — email every active person whose role holds `system.manage` and who has an email
  address, once at amber, once at red and once when it has expired, through a small loop modelled on
  `apps/server/src/attendance-email-worker.ts` with a record of which emails went out. Slice 6 IS
  built (Tasks 10a, 10b).

## 2. Decisions this plan made where the design left a choice (unattended run)

Each is the conservative reading; the reviewer of the named task checks it.

1. **The seat's vocabulary is generic.** `packages/fiscal/src/no-regime-vocabulary.test.ts` forbids
   `aeat`, `fingerprint`, `hash`, `chain`, `sif`, `csv` and others in `packages/fiscal`, so the
   seat's types say "certificate", carry the card as an opaque JSON object, and name nothing AEAT
   (Task 5).
2. **The seal seat gains `nodeId`.** `provisioningSecret.seal(deps, raw)` today gets `{ db, ring }`
   (`contribution.ts:69-79`); the install table is `local` and every write names `node_id`
   (CLAUDE.md §3), so `deps` gains `nodeId`. Both callers have it: `setup-api.ts:805`
   (`result.nodeId`) and `fiscal-readiness-runner.ts:130` (`venue.nodeId`) (Task 3).
3. **Setup records an install only when the file opens.** Setup's own checks are unchanged (that is
   A852). The seal writes the vault entry exactly as today; when the file also opens with its
   passphrase it writes an install row in the same transaction, unless the latest row for the node
   has the same fingerprint. A file that does not open is sealed with no row, and the card then
   shows "Installed: not recorded". This keeps `provisioning-secret.test.ts` and `slot.test.ts`,
   which seal 48 random bytes into databases without the fiscal migration set, passing unedited
   (Task 3).
4. **The expiry alert source is built by the host from the seat, not listed in `FISCAL_ALERTS`.**
   Design §3.8 lists it beside `fiscalSubmissionSource`, but a module's static `AlertSource.read`
   receives only `{ tx, now }` (`packages/module/src/alerts.ts:28-42`), with no node id or
   location, and the install table must be read by `node_id`. `packages/fiscal` cannot import
   `@waitron/module` (that package depends on `@waitron/fiscal`, `packages/module/package.json`), so
   the seat returns alert-shaped objects and `apps/server/src/alert-sources.ts` wraps them. The
   codes stay in `packages/fiscal-verifactu/src/certificate-alerts.ts`, which the
   `ongoing-alert-codes` guard is pointed at. `FISCAL_ALERTS` and its pin
   (`packages/fiscal-verifactu/src/alerts.test.ts:6`) do not change (Task 9b).
5. **The alert source and the reminder loop run only on a box that sends records**
   (`fiscalDrainEnabled(config)`, `apps/server/src/onboarding-policy.ts:12`), so a demo, prepare or
   test-submission-free preproduction box raises no expiry alert. POST refuses on such a box, and
   on a node that is not the singleton primary, with `fiscal.certificate_not_used` (409).
6. **The dashboard code is imported by deep path** `@waitron/fiscal-verifactu/src/dashboard/index.js`.
   The package has no `exports` map and other packages deep-import its `src/` and `test/` files
   (`git grep '@waitron/fiscal-verifactu/'` lists `test/sif-fixture.js`, `src/testing/seed.js` and
   more); adding an `exports` map to offer `./dashboard` would break every one of them.
7. **fiscal-verifactu becomes a browser package.** Its Vitest config gains a Node project and a
   Chromium project (the `packages/media` shape: `maxWorkers: 4` stays on the OUTER config, which
   `scripts/fiscal-test-budget.test.ts` pins), and its CI job `test-fiscal-verifactu` installs
   Chromium, which `scripts/ci-workflow.test.mjs`'s "gives every browser package its own shard and
   installs Chromium there" requires (Task 8a).
8. **The export guides are copied, and a root guard keeps the copy equal.** A module cannot import
   from `apps/setup`, and `apps/setup` depends on no module (`apps/setup/package.json`). The dialog
   carries its own copy of the three guides' links and the `cert_help.*` sentences
   (`apps/setup/src/i18n/strings/venue.ts:199-226` English, `:431-458` Spanish) in an import-free
   file; a new root guard `scripts/certificate-export-guides.test.ts` fails when the two copies
   differ (Task 8b).
9. **The reminder table lives in the Veri*Factu migration set**, not in `apps/server` (which owns no
   migration set), as `fiscal_certificate_reminders`, `local`, classified with `classify()` (its
   status column is updated after the send), unique on `(install_id, stage, person_id)`. A claimed
   row whose send crashed is never re-sent (at most once); a row whose SMTP server refused (`failed`)
   is retried after 24 hours; `unknown` is never re-sent (Task 10a).
10. **The reminder loop wakes hourly**, not at a fixed time of day: each pass sends every due email
    and the unique key keeps it to one per person per stage. "Expired" is due once `now >= notAfter`
    (Task 10b).
11. **AEAT error numbers are not parsed out of a fault.** The design's "AEAT refused this
    certificate for {taxpayerNif} ({codigo})" sentence needs a place in a consulta answer where
    AEAT puts its number; nothing in the repository says where. `VerifactuTransportError` carries
    `kind`, `status`, `faultCode` and `faultReason` (`@waitron/verifactu` 0.2.1 `dist/client.d.ts`),
    so a SOAP fault is shown with its code and reason as AEAT sent them (any number AEAT puts in the
    reason shows there). The `codigo` sentence is not built; Task 11 adds it to the owner's
    real-certificate checks.
12. **Live-check failure codes map only what was measured.** `unreachable` = cause code `ENOTFOUND`
    or `ECONNREFUSED` (design P9), or the build's own 30-second timer; `closed` = `UND_ERR_SOCKET` or
    `ECONNRESET` (P3, P3b); `aeat_fault` = a SOAP fault; `aeat_http` = a non-2xx answer; everything
    else is `check_failed`.
13. **Type pre-set when nothing is recorded:** `sello`, setup's own default
    (`apps/setup/src/screens/cert-screen.ts:110`).
14. **Strings the design did not write**, both languages, in Task 8a/8b: the expired status line
    ("This certificate expired on {date}. Sales continue, but fiscal records wait until you install a
    new one." / "Este certificado caducó el {date}. Las ventas continúan, pero los registros fiscales
    esperan hasta que instales uno nuevo."), "does not match the business" / "no coincide con el
    negocio", and the four request-error sentences in Task 8b. Email wording is Task 10a's.
15. **"Last accepted filing"** counts an `envios` row in `aceptado` or `aceptado_con_errores` whose
    `confirmado_en` is at or after the latest install's `installed_at`.
16. **The installer's name** comes from the host: `@waitron/fiscal-verifactu` does not depend on
    `@waitron/identity` at runtime, so the seat's `read` takes a `nameOf(tx, personId)` callback.
17. **Setup's dialog text "Install certificate" / "Replace certificate"** opens the same dialog; the
    dialog title is "Replace AEAT certificate" in both cases (design §7 has one title).

## 3. What the design says that the code contradicts (for the owner's review)

- §3.8 "listed in the module's alerts beside `fiscalSubmissionSource`": a module alert source has no
  node id (decision 4).
- §6 `src/dashboard/` as a sub-path export: the package has no `exports` map (decision 6), and it is
  a Node-only Vitest package with its own CI job (decision 7).
- §3.7 "`provisioningSecret.seal` writes the vault entry and the install record": the seat has no
  node id, and existing seal tests seal unopenable bytes (decisions 2, 3).
- §3.5 step 7 / §7 "AEAT refused ({codigo})": no source for where the number arrives (decision 11).
- §2.8/§1 measured on Node v26.11.1: **node-forge cannot build a test file with a non-ASCII
  passphrase that Node opens** — measured 2026-10-18 on Node v26.11.1, OpenSSL 4.0.3: a forge
  `toPkcs12Asn1(..., "clave ñ ", { algorithm: "aes256" })` file threw `bad decrypt` from
  `createSecureContext` with the same passphrase, while the ASCII passphrase `cert pass 9` opened.
  Tests therefore use ASCII passphrases (spaces included); a non-ASCII passphrase is an owner
  check (Task 11).
- §6 lists `scripts/ongoing-alert-codes.test.ts` "add `certificate-alerts.ts` to its list" — correct;
  noted only because the source is now host-built.

## Global Constraints

- House rules: `CLAUDE.md` in full; before touching an area read its topic file —
  `docs/developers/conventions-data.md` (Tasks 2, 3, 10a), `conventions-ui.md` and
  `design-system.md` → Forms (Tasks 7–8c), `testing-guide.md` (every task with a database or
  browser test), `ci-and-gates.md` (Task 8a).
- Every commit `git commit -s`, plain-English message. Stage explicit paths, never `git add -A`.
- Every task ends with: its focused tests (count read from the `Tests` line), `pnpm --filter <each
  touched package> typecheck`, `pnpm exec eslint <touched files>`, and `pnpm format:check`.
- The file, the passphrase and the personal fields of a certificate (subject `CN`, `serialNumber`)
  never appear in a log line, a response, an error's params, a table or a test snapshot (design
  §3.3, §3.5). The install answer is the route's normal 200 body; only request failures are errors.
- The live check holds no database transaction; the final write is one `withTransaction`.
- New error codes name the domain (`fiscal.certificate_*`), are declared in the `errors.ts` of the
  package that throws them, and that file is imported by the thrower (CLAUDE.md §3).
- Strings exactly as design §7 (English and Spanish) unless decision 14 says otherwise; the setup
  wizard's field labels, type names and passphrase sentence are reused verbatim
  (`apps/setup/src/i18n/strings/venue.ts:172-197, 402-429`).
- Every colour, spacing and radius reads a `--wt-*` token; no hex, no `rem`/`em`; no native
  `<input>`, `<select>` or `<textarea>` (use `wt-file-input`, `wt-input`, `wt-combobox`); no
  `wt-help-tooltip` in this feature.
- Coverage stays at 98/98/98/95 in every touched package; no exclude or ignore comment over
  reachable code.
- Thresholds (Q2): `sello` warning ≤ 90 days left, urgent ≤ 30; `representante` warning ≤ 60,
  urgent ≤ 14; expired once `now >= notAfter`. Days left = calendar days between the venue-local
  date of `now` and of `notAfter` (`locations.time_zone`).
- Size limit: a decoded file over 100 × 1024 bytes is refused `too_large`; the POST body limit is
  200 000 bytes.
- Live-check timer: 30 000 ms.

## Review Focus

The five inputs the spec implies but no slice names, most likely first. Each has its test in the
owning task.

1. **A role change or sign-out during the 30-second live check.** The final transaction re-runs
   `authorize`; a session ended meanwhile is refused 401/403 and nothing is written. Test in Task 4b
   ("re-authorises inside the final write") and Task 6a.
2. **A certificate with no `organizationIdentifier` and no `O`** (a self-employed owner's personal
   certificate). It goes to the live check, installs, and the card shows "not shown on the
   certificate" and "—". Tests in Task 1 and Task 4b.
3. **A passphrase with leading or trailing spaces.** Neither the dialog nor the server trims it.
   Tests in Task 1 (` cert pass 9 ` opens only with its spaces) and Task 8b (the request body
   carries the spaces).
4. **Days left across the summer-time change.** Europe/Madrid leaves summer time on 25 Oct 2026; a
   certificate ending 01:30 Madrid that day reads 1 day at 10:00 on the 24th and 0 at 00:10 on the
   25th (E9). Test in Task 1.
5. **The card when its read fails after a successful install.** The dialog closes on the install's
   success, and a failed refresh shows as a load failure on the card, never as a failed save
   (CLAUDE.md §3). Test in Task 8b.

---

## Changed test checks (running list)

The campaign rule: an existing assertion that must be EDITED to pass is a STOP, unless it only adds a
key or an entry to a whole-shape pin, or a fixture or stub only gains what it lacks. Every expected
edit is listed here; any other edit an implementer finds necessary is a STOP and a report.

| Task | File | Edit | Why it is allowed |
| --- | --- | --- | --- |
| 2 | `packages/fiscal-verifactu/src/schema-ownership.test.ts` `OWNED` | add `"fiscal_certificate_installs"`, `"fiscal_certificate_reminders"` | its comment: "Adding a table means editing this line, deliberately"; entries only |
| 2 | `scripts/append-only-triggers.test.ts` `EXPECTED` | add `"fiscal_certificate_installs"` | "adding or dropping one is a decision that should cost an edit here"; entry only |
| 3 | `packages/fiscal-verifactu/src/provisioning-secret.test.ts` (5 calls), `packages/fiscal-verifactu/src/slot.test.ts:122` | each `sealAeatSecret(...)`/`secret.seal(...)` deps object gains `nodeId: TENANT_A.nodeId` (or any id string) | a call argument gains what the new signature lacks; no assertion changes |
| 8a | `packages/fiscal-verifactu/vitest.config.ts` | becomes two projects; outer `maxWorkers: 4` kept | config, not an assertion; `scripts/fiscal-test-budget.test.ts` keeps passing unedited |
| 9b | `scripts/ongoing-alert-codes.test.ts` `ONGOING_CODE_SOURCES` | add `"packages/fiscal-verifactu/src/certificate-alerts.ts"` | the list of files the guard reads (design §6 names this edit); its assertions unchanged |

Not changed, checked: `packages/fiscal-verifactu/src/alerts.test.ts` (decision 4);
`apps/server/src/alert-sources.test.ts:546-552` uses `toMatchObject`, so the awaiting alert's new
`screen` key passes it; `apps/server/src/fiscal-readiness-runner.test.ts:417` uses
`toMatchObject({ ring })`; the stub seals at `fiscal-readiness-allocation.test.ts:202`,
`fiscal-readiness-runner.verifactu.test.ts:77` and `fiscal-readiness-runner.test.ts:395` still
typecheck (fewer parameters); `packages/credentials/src/cli.test.ts` checks usage with `toContain`.

## Review path per task

FULL path for the branch (fiscal-adjacent, a migration, a secret write, a cross-package contract);
`/finish-branch` runs the whole wave with the Codex run-it seat twice. Per-task reviewer:

| Task | Title | Per-task reviewer |
| --- | --- | --- |
| 1 | Read and check a certificate file; calendar days and stages | yes |
| 2 | The install and reminder tables, migration, classification, manifest | yes |
| 3 | Setup's seal writes the install record | yes |
| 4a | The live check with AEAT | yes |
| 4b | The install transaction and the card's read | yes |
| 5 | The `certificate` seat (read, install) and its wiring | yes |
| 6a | `GET`/`POST /management-api/fiscal-certificate` | yes |
| 6b | Mount the routes in boot; the real seat through the route | yes |
| 7 | A dashboard contribution may bring only settings panels | yes |
| 8a | Browser project, CI, client, strings, the card | yes |
| 8b | The Replace dialog and the export guides | yes |
| 8c | Accessibility, unsaved changes, and a look at both themes and phone width | no (LIGHT) |
| 9a | `{name:date}` alert slot and alert wording | no (LIGHT) |
| 9b | The expiry alert source | yes |
| 10a | Reminder claims and wording | yes |
| 10b | The reminder email loop | yes |
| 11 | Docs, backlog, usage text | no (LIGHT) |

---

## Task 1: Read and check a certificate file; calendar days and stages

**Files:**
- Create: `packages/fiscal-verifactu/src/certificate-file.ts`, `packages/fiscal-verifactu/src/certificate-file.test.ts`
- Create: `packages/fiscal-verifactu/src/certificate-dates.ts`, `packages/fiscal-verifactu/src/certificate-dates.test.ts`
- Create: `packages/fiscal-verifactu/test/certificate-fixtures.ts`, `packages/fiscal-verifactu/test/rc2-certificate.ts`
- Modify: `packages/fiscal-verifactu/package.json` (devDependencies `node-forge` `^1.3.1`, `@types/node-forge` `^1.3.0`, the versions `packages/server-kit/package.json` uses), `pnpm-lock.yaml` via `pnpm install`

**Interfaces — Produces:**
```ts
// certificate-file.ts
export const CERTIFICATE_MAX_BYTES = 100 * 1024;
export type OpenRefusal = "passphrase_wrong" | "old_encryption" | "no_private_key" | "unreadable";
export interface CertificateDetails {
  organisation: string | null;   // subject O
  taxId: string | null;          // from subject organizationIdentifier, normalised, "VATxx-" stripped
  issuer: string | null;         // "CN (O)", or whichever exists
  validFrom: Date; validUntil: Date;
  fingerprint: string;           // X509Certificate.fingerprint256
}
export function openCertificateFile(pfx: Buffer, passphrase: string):
  { ok: true; details: CertificateDetails } | { ok: false; reason: OpenRefusal };
export function normaliseTaxId(value: string): string; // upper case, spaces and hyphens removed
// certificate-dates.ts
export type CertificateStage = "warning" | "urgent" | "expired";
export const CERTIFICATE_THRESHOLDS: Readonly<Record<CertKind, { warning: number; urgent: number }>>;
  // { sello: { warning: 90, urgent: 30 }, representante: { warning: 60, urgent: 14 } }
export function localDate(at: Date, timeZone: string): string;          // "YYYY-MM-DD"
export function localMidnight(day: string, timeZone: string): string;   // ISO instant
export function calendarDaysLeft(now: Date, validUntil: Date, timeZone: string): number; // may be negative
export function certificateStage(kind: CertKind, now: Date, validUntil: Date, timeZone: string): CertificateStage | null;
export function stageSince(kind: CertKind, stage: CertificateStage, validUntil: Date, timeZone: string): string; // ISO
// test/certificate-fixtures.ts (test-only; imported by later tasks and by apps/server tests)
export interface FixtureAuthority { caPem: string; serverKeyPem: string; serverCertPem: string; }
export function makeAuthority(): FixtureAuthority & { issue(o?: CandidateOptions): Candidate };
export interface CandidateOptions { organisation?: string | null; organizationIdentifier?: string | null;
  notBefore?: Date; notAfter?: Date; passphrase?: string; algorithm?: "aes256" | "3des";
  withKey?: boolean; signedBy?: "authority" | "stranger"; commonName?: string; }
export interface Candidate { pfx: Buffer; passphrase: string; fingerprint: string; }
export function mtlsMaterialFor(authority, candidate: Candidate): MtlsMaterial; // for startMtlsServer
export function startAnsweringServer(authority: FixtureAuthority, answer: { status: number; body: string;
  maxVersion?: "TLSv1.2" | "TLSv1.3"; hold?: Promise<void> }): Promise<{ origin: string;
  requests(): number; sawClientCn(): string | null; close(): Promise<void> }>;
export const SIN_DATOS_BODY: string; export const SOAP_FAULT_BODY: string;
```

- [ ] **Step 1: the fixture builder.** In `test/certificate-fixtures.ts`, with node-forge: one RSA
  2048 key pair per module load, reused by every candidate (generation is the slow part). A CA
  (`CN=Waitron test FNMT`, `O=Test FNMT`), a server certificate for `127.0.0.1` (iPAddress SAN, as
  `packages/server-kit/src/testing/mtls.ts:41-53`), and a "stranger" CA. `issue()` defaults:
  subject `organizationIdentifier` (attribute type `"2.5.4.97"`) = `VATES-89890001K` (the tax ID
  `test/fixtures.ts:51` seeds), `O` = `WAITRON SL`, `CN` = `12345678Z ANA GARCIA (R: 89890001K)`,
  `serialNumber` = `IDCES-12345678Z`, issuer `CN=Waitron test FNMT, O=Test FNMT`, valid
  2026-01-01T00:00:00Z – 2030-01-01T00:00:00Z, passphrase `cert-pass-9`, `algorithm: "aes256"`.
  `null` for `organisation`/`organizationIdentifier` leaves the attribute out. `withKey: false`
  passes `null` as the key to `forge.pkcs12.toPkcs12Asn1`. `startAnsweringServer` is a `node:https`
  server with `requestCert: true, rejectUnauthorized: true`, `ca` = the authority, the given
  `maxVersion`, answering `status`/`body` after `hold` resolves. `SIN_DATOS_BODY` and
  `SOAP_FAULT_BODY` are the two envelopes below.

  Measured 2026-10-18 (Node v26.11.1, OpenSSL 4.0.3, `@waitron/verifactu` 0.2.1, scratch script
  outside the repo): `createClient({ endpoint, fetch: async () => new Response(SIN_DATOS_BODY) })
  .consultar({ ObligadoEmision: { NombreRazon: "Waitron SL", NIF: "89890001K" } }, { Ejercicio:
  "2026", Periodo: "10" })` resolved `{"ResultadoConsulta":"SinDatos","IndicadorPaginacion":"N",
  "registros":[]}` for
  `<?xml version="1.0" encoding="UTF-8"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><tikR:RespuestaConsultaFactuSistemaFacturacion xmlns:tikR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/RespuestaConsultaLR.xsd"><tikR:Cabecera><tik:IDVersion xmlns:tik="x">1.0</tik:IDVersion></tikR:Cabecera><tikR:PeriodoImputacion><tikR:Ejercicio>2026</tikR:Ejercicio><tikR:Periodo>10</tikR:Periodo></tikR:PeriodoImputacion><tikR:IndicadorPaginacion>N</tikR:IndicadorPaginacion><tikR:ResultadoConsulta>SinDatos</tikR:ResultadoConsulta></tikR:RespuestaConsultaFactuSistemaFacturacion></env:Body></env:Envelope>`;
  and threw `VerifactuTransportError` `kind "soap"`, `status 500`, `faultCode "env:Client"` for
  `<?xml version="1.0"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault><faultcode>env:Client</faultcode><faultstring>Test fault</faultstring></env:Fault></env:Body></env:Envelope>`
  answered with status 500, and `kind "http"`, `status 403` for `<html>forbidden</html>` with 403.
  `Test fault` is our own text, not AEAT's.

- [ ] **Step 2: the RC2 file.** forge cannot write RC2. In a fresh `mktemp -d` directory (never in
  the worktree), run exactly:
  ```bash
  openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -days 3650 \
    -subj "/organizationIdentifier=VATES-89890001K/O=WAITRON SL/CN=RC2 TEST"
  openssl pkcs12 -export -legacy -inkey k.pem -in c.pem -out rc2.p12 -passout pass:cert-pass-9
  openssl pkcs12 -info -in rc2.p12 -passin pass:cert-pass-9 -legacy -noout   # must print pbeWithSHA1And40BitRC2-CBC
  base64 -i rc2.p12
  ```
  and write `test/rc2-certificate.ts` exporting `RC2_CANDIDATE = { pfxBase64: "<that>", passphrase:
  "cert-pass-9" }`, with a two-line comment giving the commands. Measured 2026-10-18 with OpenSSL
  4.0.3: these commands printed `PKCS7 Encrypted data: pbeWithSHA1And40BitRC2-CBC`, and Node
  v26.11.1 refused the file `ERR_CRYPTO_UNSUPPORTED_OPERATION Unsupported PKCS12 PFX data` with the
  right passphrase and `mac verify failure` (no code) with a wrong one.

- [ ] **Step 3: failing tests, `certificate-file.test.ts`.** Each asserts the exact reason:
  - `opens a valid file and reads organisation, tax ID, issuer, dates and fingerprint` →
    `{ ok: true, details: { organisation: "WAITRON SL", taxId: "89890001K", issuer: "Waitron test FNMT (Test FNMT)", validFrom: new Date("2026-01-01T00:00:00Z"), validUntil: new Date("2030-01-01T00:00:00Z"), fingerprint: candidate.fingerprint } }`
    (`candidate.fingerprint` computed in the fixture from `new X509Certificate(certDer).fingerprint256`).
  - `opens the same certificate packed with 3DES` → ok, same fingerprint as the AES one.
  - `refuses a wrong passphrase as passphrase_wrong`; `refuses the RC2 file with the right passphrase
    as old_encryption`; `refuses the RC2 file with a wrong passphrase as passphrase_wrong`;
    `refuses a file without a private key as no_private_key`; `refuses 600 random bytes as
    unreadable`; `refuses an empty buffer as unreadable`.
  - `keeps the passphrase exactly: " cert pass 9 " opens, "cert pass 9" does not` (Review Focus 3).
  - `reads no tax ID and no organisation when the certificate carries neither` → `taxId: null,
    organisation: null`, still `ok: true` (Review Focus 2).
  - `strips a VATES- prefix and ignores case, spaces and hyphens`: `organizationIdentifier`
    `"vates-b 1234-5678"` → `taxId: "B12345678"`; and `normaliseTaxId(" b-1234 5678 ")` → `"B12345678"`.
  - `never returns the subject's CN or serialNumber`: `JSON.stringify(result)` contains neither
    `"ANA GARCIA"` nor `"12345678Z"`.
- [ ] **Step 4: run, see them fail:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-file.test.ts`
- [ ] **Step 5: implement `openCertificateFile`.** `tls.createSecureContext({ pfx, passphrase })`
  in a `try`: `error.code === "ERR_CRYPTO_UNSUPPORTED_OPERATION"` → `old_encryption`;
  `error.code === "ERR_CRYPTO_OPERATION_FAILED"` → `no_private_key`; `/mac verify failure/` on the
  message (no code) → `passphrase_wrong`; anything else → `unreadable`. Measured 2026-10-18 on Node
  v26.11.1 / OpenSSL 4.0.3 with forge-built files: wrong passphrase `code undefined, mac verify
  failure`; no key `ERR_CRYPTO_OPERATION_FAILED Unable to load private key from PFX data`; 600
  random bytes `code undefined, wrong tag`. Then `const s = new TLSSocket(null, { secureContext })`,
  `const c = s.getCertificate()`, `s.destroy()`; `c.subject` was measured as
  `{"organizationIdentifier":"VATES-89890001K","O":"WAITRON SL","CN":"…","serialNumber":"…"}` and
  `c.issuer` as `{"CN":"AC Test","O":"Test CA"}`. Dates and fingerprint from
  `new X509Certificate(c.raw)` (`validFromDate`, `validToDate`, `fingerprint256`). A subject
  attribute may be an array (`subject.CN` is typed `string | string[]`,
  `packages/server-kit/src/testing/mtls.ts:107-108`): take the first. Read only `O`,
  `organizationIdentifier` and the issuer's `CN`/`O`.
- [ ] **Step 6: failing tests, `certificate-dates.test.ts`** (timeZone `"Europe/Madrid"`):
  - E9: `calendarDaysLeft(new Date("2026-10-24T08:00:00Z"), new Date("2026-10-24T23:30:00Z"), tz)` → `1`;
    at `2026-10-24T22:10:00Z` → `0` (Review Focus 4: that night leaves summer time).
  - E8, representative ending `2026-10-24T22:59:00Z` (00:59 Madrid on 25 Oct):
    `certificateStage("representante", new Date("2026-08-25T10:00:00Z"), end, tz)` → `null` (61 days);
    `2026-08-26T10:00:00Z` → `"warning"` (60); `2026-10-11T10:00:00Z` → `"urgent"` (14);
    `2026-10-24T22:58:59Z` → `"urgent"`; `2026-10-24T22:59:00Z` → `"expired"`.
  - Seal, same end: `2026-07-27T10:00:00Z` → `"warning"` (90), `2026-07-26T10:00:00Z` → `null`,
    `2026-09-25T10:00:00Z` → `"urgent"` (30).
  - `stageSince("representante", "warning", end, tz)` → `"2026-08-25T22:00:00.000Z"` (midnight
    26 Aug, Madrid summer time); `stageSince(_, "expired", end, tz)` → `"2026-10-24T22:59:00.000Z"`.
  - `localDate(new Date("2026-10-24T22:10:00Z"), tz)` → `"2026-10-25"`.
- [ ] **Step 7: implement** with `businessDayAt` and `businessDayBoundaryAt` from `@waitron/shared`
  (`packages/shared/src/business-day-clock.ts:98,110`) over the clock
  `{ timeZone, dayCutover: "00:00", cutoverChanges: [] }`; days are the difference of the two
  `YYYY-MM-DD` dates read as UTC midnights, divided by 86 400 000.
- [ ] **Step 8: run both files green;** typecheck, lint, `pnpm format:check`.
- [ ] **Step 9: commit** `git commit -s -m "Read an AEAT certificate file and say why one cannot be used; count its days left in the venue's calendar (A795)"`

---

## Task 2: The install and reminder tables, migration, classification, manifest

**Files:**
- Create: `packages/fiscal-verifactu/src/schema/certificate-installs.ts`, `packages/fiscal-verifactu/src/schema/certificate-reminders.ts`
- Modify: `packages/fiscal-verifactu/src/schema/index.ts`, `packages/fiscal-verifactu/src/classification.ts`, `packages/migrations/migrations.manifest.json` (fiscal-verifactu's `appendOnlyTables`, line 84-90)
- Generated: `packages/fiscal-verifactu/drizzle/0007_*.sql`, its snapshot, `_journal.json`
- Modify (Changed test checks): `src/schema-ownership.test.ts`, `scripts/append-only-triggers.test.ts`
- Test: `packages/fiscal-verifactu/src/certificate-tables.test.ts`

**Interfaces — Produces** (column builders only from `@waitron/db`: `id`, `label`, `ts`, `enumType`,
`enumCheck`, `table`, `newId`, as `src/schema/filing-cases.ts` does):
```ts
export const certificateSource = enumType(["setup", "dashboard"]);
export const certificateKind = enumType(["sello", "representante"]);
export const fiscalCertificateInstalls = table("fiscal_certificate_installs", {
  id: id("id").primaryKey().$defaultFn(newId),
  nodeId: id("node_id").notNull(),          // no foreign key: a local table (CLAUDE.md §3)
  installedAt: ts("installed_at").notNull(),
  source: certificateSource("source").notNull(),
  personId: id("person_id"),                // null for setup; no FK: persons is identity's set
  kind: certificateKind("kind").notNull(),
  fingerprint: label("fingerprint").notNull(),
  organisation: label("organisation"),
  taxId: label("tax_id"),
  issuer: label("issuer"),
  validFrom: ts("valid_from").notNull(),
  validUntil: ts("valid_until").notNull(),
  checkedEndpoint: label("checked_endpoint"), // null for setup
  checkedAt: ts("checked_at"),                // null for setup
}, (t) => [index("fiscal_certificate_installs_node_idx").on(t.nodeId, t.installedAt),
  check(...enumCheck(source)), check(...enumCheck(kind)),
  check("fiscal_certificate_installs_dashboard_ck", sql`${t.source} = 'setup' or (${t.personId} is not null and ${t.checkedAt} is not null and ${t.checkedEndpoint} is not null)`)]);
export const reminderStage = enumType(["warning", "urgent", "expired"]);
export const reminderStatus = enumType(["claimed", "sent", "failed", "unknown"]);
export const fiscalCertificateReminders = table("fiscal_certificate_reminders", {
  id: id("id").primaryKey().$defaultFn(newId),
  nodeId: id("node_id").notNull(),
  installId: id("install_id").notNull().references(() => fiscalCertificateInstalls.id),
  stage: reminderStage("stage").notNull(),
  personId: id("person_id").notNull(),      // no FK, as above; no email address is stored
  status: reminderStatus("status").notNull(),
  claimedAt: ts("claimed_at").notNull(),
  reportedAt: ts("reported_at"),
}, (t) => [uniqueIndex("fiscal_certificate_reminders_uq").on(t.installId, t.stage, t.personId),
  check(...enumCheck(stage)), check(...enumCheck(status))]);
```
Classification (`src/classification.ts`):
`appendOnly("fiscal_certificate_installs", "local", "the certificates installed on one node, keyed by its node id; the certificate is sealed under that node's key")` and
`classify("fiscal_certificate_reminders", "local", "the expiry emails one node sent about its own certificate, keyed by its node id")`.
The local-to-local foreign key is allowed (`packages/sync-enrolment/src/classification.ts:7-9`
forbids only local↔ledger/state).

- [ ] **Step 1: failing test `certificate-tables.test.ts`** (`useVenueDb({ migrations: TEST_MIGRATIONS })`
  from `../test/migrations.js`): `refuses an UPDATE and a DELETE of an install row` (catch the
  refusal OUTSIDE the transaction, assert the message names the append-only trigger, as
  `src/inmutabilidad.test.ts` does); `refuses a dashboard install with no person`
  (CHECK refusal); `refuses a second reminder for the same install, stage and person` (unique);
  `accepts a setup install with no person, endpoint or check time`.
- [ ] **Step 2: run it, see it fail** (no table).
- [ ] **Step 3: add the two schema files and export both from `src/schema/index.ts`; add the
  classification entries; add `"fiscal_certificate_installs"` to the manifest's fiscal-verifactu
  `appendOnlyTables`.**
- [ ] **Step 4: generate the migration against the current tree — never hand-written, never
  hand-numbered:** `pnpm --filter @waitron/fiscal-verifactu db:generate --name certificate_installs`
  (script `drizzle-kit generate`, `packages/fiscal-verifactu/package.json`). Expect one new
  `0007_certificate_installs.sql` with two `CREATE TABLE`s and their indexes, plus snapshot and
  journal. This generation creates tables only; it must not rebuild an existing one. (The house
  rule for drizzle-kit 0.31.10–0.31.11: a generation that rebuilds a table must not also add a
  column to it — CLAUDE.md §3; not expected to arise here. If the generated SQL rebuilds anything,
  STOP.) Do not edit the generated files. On a later rebase collision, regenerate per CLAUDE.md §3.
- [ ] **Step 5: the two Changed-test-checks edits** (schema-ownership `OWNED`, append-only
  `EXPECTED`), entries only.
- [ ] **Step 6: run** the new test, `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/schema-ownership.test.ts src/classification.test.ts src/migrations.test.ts`,
  and the migration guards from the root:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/append-only-migration-sets.test.ts scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts scripts/journal-monotonic.test.ts scripts/column-vocabulary.test.ts`,
  `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`, and the fiscal
  core suites UNEDITED: `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad` and
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts`.
- [ ] **Step 7: commit** `git commit -s -m "Add the tables that record each AEAT certificate install and each expiry email, append-only and per node (A795)"`

---

## Task 3: Setup's seal writes the install record

**Files:**
- Modify: `packages/fiscal/src/contribution.ts` (`provisioningSecret.seal` deps gain `nodeId: string`)
- Create: `packages/fiscal-verifactu/src/certificate-record.ts`, `packages/fiscal-verifactu/src/certificate-record.test.ts`
- Modify: `packages/fiscal-verifactu/src/provisioning-secret.ts`, `src/slot.ts:85-89`
- Modify: `apps/server/src/setup-api.ts:805`, `apps/server/src/fiscal-readiness-runner.ts:130`
- Modify (Changed test checks): `src/provisioning-secret.test.ts`, `src/slot.test.ts:122` (call arguments only)

**Interfaces — Consumes:** Task 1 `openCertificateFile`; Task 2 tables. **Produces:**
```ts
// certificate-record.ts
export type InstallRow = typeof fiscalCertificateInstalls.$inferSelect;
export async function latestInstall(tx: Transaction, nodeId: string): Promise<InstallRow | null>;
export async function recordInstall(tx: Transaction, row: typeof fiscalCertificateInstalls.$inferInsert): Promise<void>;
// provisioning-secret.ts
export async function sealAeatSecret(deps: { db: Database; ring: KeyRing; nodeId: string; now?: () => Date }, raw: unknown): Promise<void>;
export function isBase64(value: string): boolean; // now exported, unchanged
```

- [ ] **Step 1: failing tests in `certificate-record.test.ts`** (`TEST_MIGRATIONS`, `seedTenantTillSif`,
  a fixture candidate from Task 1, `TENANT_A.nodeId`):
  - `setup's seal writes the vault entry and one install row when the file opens` → row with
    `source "setup"`, `personId null`, `kind`, `fingerprint`, `organisation "WAITRON SL"`, `taxId
    "89890001K"`, dates, `checkedEndpoint null`, `checkedAt null`, `nodeId TENANT_A.nodeId`.
  - `a resumed setup sealing the same file writes no second row` (seal twice → 1 row).
  - `a different file writes a second row` (2 rows, latest is the new fingerprint).
  - `a file that does not open is sealed with no install row` (random bytes → vault holds it,
    0 rows).
  - `latestInstall reads only the asking node's rows` (a row for `TENANT_A.nodeId2` is not returned
    for `TENANT_A.nodeId`).
  - `the install row and the vault entry commit together` — seal an openable file with
    `now: () => new Date(Number.NaN)`: the `installed_at` column converts with `toISOString()`
    (`packages/db/src/schema/columns.ts:23-27`), which throws `RangeError` inside the transaction
    after `putCredential`; assert the error and that `tryGetCredential` finds no `fiscal.aeat`. If
    the throw does not happen inside the transaction, STOP and report rather than reshaping the
    code to make it.
- [ ] **Step 2: run, see them fail.**
- [ ] **Step 3: implement.** In `sealAeatSecret`, after `parseAeatCert`, call `openCertificateFile`
  on the decoded bytes BEFORE opening the transaction; inside the one `withTransaction`:
  `putCredential` exactly as today, then — only if it opened — `latestInstall`; if absent or a
  different fingerprint, `recordInstall`. The table is touched only when the file opened, so a
  database without the fiscal set still seals unopenable bytes (decision 3). The seat in
  `slot.ts` passes `deps` through. `contribution.ts`: document `nodeId` as "the node whose vault
  holds the secret".
- [ ] **Step 4: callers:** `setup-api.ts:805` → `secret!.seal({ db, ring, nodeId: result.nodeId }, rawSecret)`;
  `fiscal-readiness-runner.ts:130` → `secret.seal({ db, ring: args.ring, nodeId: venue.nodeId }, args.secret)`.
- [ ] **Step 5: the Changed-test-checks call arguments** in `provisioning-secret.test.ts` and
  `slot.test.ts:122` gain `nodeId`. No assertion changes.
- [ ] **Step 6: run** the new file; `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/provisioning-secret.test.ts src/slot.test.ts src/certificate-record.test.ts`;
  `pnpm --filter @waitron/server exec vitest run src/setup-api.test.ts src/fiscal-readiness-runner.test.ts src/fiscal-readiness-runner.verifactu.test.ts src/fiscal-readiness-allocation.test.ts src/setup-email-provision.test.ts`;
  `pnpm --filter @waitron/fiscal exec vitest run`; the two fiscal core suites UNEDITED (as Task 2
  Step 6); typecheck `@waitron/fiscal`, `@waitron/fiscal-verifactu`, `@waitron/server`.
- [ ] **Step 7: commit** `git commit -s -m "Record the AEAT certificate setup installs, once per certificate, beside its vault entry (A795)"`

---

## Task 4a: The live check with AEAT

**Files:**
- Create: `packages/fiscal-verifactu/src/certificate-check.ts`, `packages/fiscal-verifactu/src/certificate-check.test.ts`

**Interfaces — Consumes:** `mtlsFetch`, `aeatEndpointFor`, `CertMaterial`, `TenantTransport`
(`src/aeat-transport.ts:23-28, 77-82, 101-117`); `createClient`, `VerifactuTransportError` from
`@waitron/verifactu`; `firstCodeInCauseChain` from `@waitron/shared`
(`packages/shared/src/cause-chain.ts:16`); `localDate` (Task 1). **Produces:**
```ts
export type CheckRefusal =
  | { reason: "unreachable" } | { reason: "closed" }
  | { reason: "aeat_fault"; details: { faultCode: string; faultReason: string } }
  | { reason: "aeat_http"; details: { status: number } }
  | { reason: "check_failed" };
export interface CheckTransport { endpointFor(kind: CertKind): string; fetchFor(material: CertMaterial): TenantTransport; }
export async function checkWithAuthority(input: {
  material: CertMaterial; taxpayer: { legalName: string; taxId: string };
  timeZone: string; now: Date; transport: CheckTransport; timeoutMs?: number; // default 30_000
}): Promise<{ ok: true; endpoint: string } | ({ ok: false } & CheckRefusal)>;
```

- [ ] **Step 1: failing tests** (fixture authority from Task 1; `transport.fetchFor = (m) => mtlsFetch(m, authority.caPem)`,
  `endpointFor = () => server.origin`):
  - `passes on a SinDatos answer and names the endpoint it asked` (server answers 200
    `SIN_DATOS_BODY`; `requests() === 1`).
  - `asks for the taxpayer and the current month in the venue's zone` — capture the request body;
    at `now = 2026-10-31T23:30:00Z` in Europe/Madrid it carries `<…Ejercicio>2026<` and
    `<…Periodo>11<`, and `NIF` `89890001K`.
  - `reports closed when the server refuses the certificate over TLS 1.3` (candidate `signedBy:
    "stranger"`, `maxVersion: "TLSv1.3"`; `requests() === 0`).
  - `reports closed when the server refuses the certificate over TLS 1.2` (`maxVersion: "TLSv1.2"`).
    The design measured `ECONNRESET` there and `UND_ERR_SOCKET` on 1.3 (P3b); if this machine shows
    another code, STOP and report rather than widening the list.
  - `reports unreachable for a refused connection` (a port bound then closed, so nothing listens).
  - `reports unreachable for a name that does not resolve` — a fake `fetchFor` whose fetch rejects
    with `new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) })`
    (the real lookup is slow offline).
  - `reports unreachable when AEAT does not answer within the timer` (`hold` never resolves,
    `timeoutMs: 200`; the test then releases `hold` and closes the server).
  - `reports aeat_fault with the fault code and reason` (status 500, `SOAP_FAULT_BODY` →
    `details { faultCode: "env:Client", faultReason: "Test fault" }`).
  - `reports aeat_http with the status` (status 403, `<html>forbidden</html>`).
  - `reports check_failed for an answer it cannot parse` (200, `<not-soap/>`).
  - `closes the transport it opened, whatever the outcome` (spy on `close`).
- [ ] **Step 2: run, see them fail:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/certificate-check.test.ts`
- [ ] **Step 3: implement.** Build `transport.fetchFor(material)`; wrap its `fetch` so each call
  carries an `AbortController` signal armed by a `setTimeout(timeoutMs)` that sets a local
  `timedOut` flag; `createClient({ endpoint: transport.endpointFor(material.certKind), fetch: wrapped })`
  then `consultar({ ObligadoEmision: { NombreRazon: legalName, NIF: taxId } }, { Ejercicio, Periodo })`
  with `Ejercicio`/`Periodo` from `localDate(now, timeZone)`. Classify per decision 12:
  `VerifactuTransportError` `kind "soap"` → `aeat_fault` (missing code or reason → `""`), `"http"` →
  `aeat_http`, `"network"` → `timedOut` or a cause code `ENOTFOUND`/`ECONNREFUSED` →
  `unreachable`, `UND_ERR_SOCKET`/`ECONNRESET` → `closed`, else `check_failed`; any other error →
  `check_failed`. Clear the timer and `await transport.close()` in `finally`, swallowing a close
  failure. Nothing here touches the database.
- [ ] **Step 4: run green;** typecheck, lint, format.
- [ ] **Step 5: commit** `git commit -s -m "Ask AEAT a read-only question with a new certificate and say plainly why it failed (A795)"`

---

## Task 4b: The install transaction and the card's read

**Files:**
- Create: `packages/fiscal-verifactu/src/certificate.ts`, `packages/fiscal-verifactu/src/certificate.test.ts`, `packages/fiscal-verifactu/src/certificate.concurrency.test.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts`

**Interfaces — Consumes:** Tasks 1, 3, 4a; `credentialRevision`, `putCredential` from
`@waitron/credentials` (`packages/credentials/src/store.ts:96,131`); `tenants`, `locations` from
`@waitron/db`. **Produces:**
```ts
export const CERTIFICATE_REFUSAL_REASONS = ["too_large", "unreadable", "old_encryption", "no_private_key",
  "passphrase_wrong", "expired", "not_yet_valid", "same", "other_taxpayer",
  "unreachable", "closed", "aeat_fault", "aeat_http", "check_failed"] as const;
export interface InstallAnswer { outcome: "installed" | "refused"; reason: "installed" | (typeof CERTIFICATE_REFUSAL_REASONS)[number];
  field?: "file" | "passphrase"; details?: Record<string, string | number>; }
export interface InstallDeps { db: Database; ring: KeyRing; nodeId: string; locationId: string;
  environment: DeploymentEnvironment; authorize(tx: Transaction): Promise<{ personId: string }>;
  log?: FiscalDutyLog; transport?: CheckTransport; checkTimeoutMs?: number; }
export async function installCertificate(deps: InstallDeps, body: unknown, now: Date): Promise<InstallAnswer>;
export interface CertificateCard { revision: string | null; timeZone: string; installed: null | {
  kind: CertKind; organisation: string | null; taxId: string | null; taxIdMatches: boolean | null;
  issuer: string | null; validFrom: string; validUntil: string; daysLeft: number; stage: CertificateStage | null;
  installedAt: string; source: "setup" | "dashboard"; installedByName: string | null; lastAcceptedAt: string | null; } }
export async function readCertificateCard(deps: { db: Database; nodeId: string; locationId: string;
  nameOf(tx: Transaction, personId: string): Promise<string | null> }, now: Date): Promise<CertificateCard>;
export async function venueTimeZone(tx: Transaction, locationId: string): Promise<string>; // as apps/server/src/venue-time-zone.ts:5-19, "UTC" fallback
```
Errors (`src/errors.ts`, with a one-line doc each): `"fiscal.certificate_changed": Record<string, never>`
(another install landed after the dialog read the card) and
`"fiscal.certificate_request_invalid": { field: string }` (names the field, never its value).

- [ ] **Step 1: failing tests, `certificate.test.ts`** (`TEST_MIGRATIONS`, `seedTenantTillSif`, fixture
  authority and an answering server as the transport, `authorize: async () => ({ personId: "p-1" })`,
  `now = 2026-10-18T11:00:00Z`). The body is `{ pfxBase64, passphrase, certKind, expectedRevision }`.
  - Order and first-failure-wins, each asserting the whole answer AND that `fiscal.aeat`'s revision
    and the install rows are unchanged:
    `too_large` (101 × 1024 decoded bytes) field `file`;
    `unreadable` field `file`; `old_encryption` field `file` (RC2); `no_private_key` field `file`;
    `passphrase_wrong` field `passphrase`;
    `expired` field `file` details `{ date: "2026-10-01" }` (a candidate ending
    `2026-10-01T10:00:00Z`); `not_yet_valid` field `file` details `{ date: "2027-01-01" }`;
    `same` field `file` (the installed fingerprint again);
    `other_taxpayer` field `file` details `{ nif: "B87654321", taxpayerNif: "89890001K" }`;
    and for each of these `server.requests() === 0` — nothing reached AEAT.
  - `a certificate with no tax ID goes on to the live check and installs` (Review Focus 2).
  - Live-check refusals pass through with no `field`: `closed`, `aeat_fault` with details,
    `aeat_http` with details.
  - `installs: writes the vault entry and one dashboard row, answers installed with checkedAt` →
    `{ outcome: "installed", reason: "installed", details: { checkedAt: now.toISOString() } }`; the
    row has `source "dashboard"`, `personId "p-1"`, `checkedEndpoint` = the server origin.
  - `refuses fiscal.certificate_changed when the vault changed after the card was read` (pass a
    stale `expectedRevision`; throws the `AppError`; nothing written).
  - `re-authorises inside the final write` (Review Focus 1): `authorize` resolves the first time and
    throws `AppError("authorization.not_permitted")` the second; the error propagates and nothing is
    written.
  - `refuses a malformed body as fiscal.certificate_request_invalid naming the field`: not an object
    → `body`; non-canonical base64 → `pfxBase64`; empty passphrase → `passphrase`; `certKind
    "bogus"` → `certKind`; `expectedRevision: 5` → `expectedRevision`.
  - `logs the install with fingerprint and dates, and a refusal with only reason and field`;
    `JSON.stringify` of every logged field contains neither the passphrase nor the base64 file.
  - `readCertificateCard` cases: none installed and empty vault → `{ revision: null, installed: null }`;
    vault but no row → `revision` set, `installed: null`; a row → every field, `taxIdMatches: true`
    for `89890001K` and `false` for another, `null` with no tax ID; `daysLeft`/`stage` from Task 1;
    `installedByName` from `nameOf` (`null` for setup); `lastAcceptedAt` = the latest `confirmado_en`
    of an `aceptado` or `aceptado_con_errores` envío at or after `installedAt` (seed with
    `seedPendingEnvios` from `test/drain-fixtures.ts` and update the rows' state in the test),
    `null` when none.
- [ ] **Step 2: failing tests, `certificate.concurrency.test.ts`:**
  - `a write commits while the live check is held open` — `hold` an answering server; start
    `installCertificate` (not awaited); wait until `server.requests()` would increment (poll the
    handler entry with a promise the fixture resolves when the request arrives); then
    `await withTransaction(db, tx => putCredential(tx, ring, { purpose: "email.smtp", value: { url: "smtp://x:25", from: "a@b.test" } }))`
    must resolve before `hold` is released; release; the install answers `installed`.
  - `a pass that resolved its client before the install keeps the old certificate, and the next pass
    uses the new one` (E7 and P4): `aeatClientResolver` (`src/aeat-transport.ts:142`) with
    `fetchFor: (m) => mtlsFetch(m, caPem)` resolves client A; install candidate B (CN
    `NEW CERT`); client A's `consultar` reaches the server with the old CN
    (`sawClientCn()`), a fresh resolver's client presents `NEW CERT`.
- [ ] **Step 3: run, see them fail.**
- [ ] **Step 4: implement `installCertificate`** in this order: parse the body (errors above);
  decode; size; `openCertificateFile`; dates against `now`; read in one short read transaction the
  tenant (`taxId`, `legalName`), the venue zone and `latestInstall` — and call `deps.authorize(tx)`
  there first, so an unauthorised caller never reaches the network; `same`; tax ID (only when the
  certificate has one); `checkWithAuthority` with `deps.transport ?? { endpointFor:
  aeatEndpointFor(environment), fetchFor: mtlsFetch }` — OUTSIDE any transaction; then one
  `withTransaction`: `authorize(tx)` again, `credentialRevision` vs `expectedRevision` →
  `fiscal.certificate_changed`, `putCredential` (unchanged), `recordInstall`. Log
  `fiscal.certificate_installed` `{ fingerprint, validFrom, validUntil, endpoint }` or
  `fiscal.certificate_refused` `{ reason, field }` at `info`.
- [ ] **Step 5: implement `readCertificateCard`** (one read transaction; no decryption: the
  revision comes from `credentialRevision`, everything else from the row).
- [ ] **Step 6: run both files green;** also `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/aeat-transport.test.ts src/provisioning-secret.test.ts`; typecheck, lint, format.
- [ ] **Step 7: commit** `git commit -s -m "Install an AEAT certificate only after every check and AEAT's answer pass, in one short write, and read the card's facts without decrypting (A795)"`

---

## Task 5: The `certificate` seat (read, install) and its wiring

**Files:**
- Modify: `packages/fiscal/src/contribution.ts`, `packages/fiscal/src/contribution.test.ts`
- Modify: `packages/fiscal-verifactu/src/slot.ts`, `packages/fiscal-verifactu/src/slot.test.ts` (new cases only)

**Interfaces — Produces** (in `contribution.ts`; no word from the forbidden list in
`packages/fiscal/src/no-regime-vocabulary.test.ts:59-73`):
```ts
export interface FiscalCertificateAnswer { readonly outcome: "installed" | "refused"; readonly reason: string;
  readonly field?: string; readonly details?: Readonly<Record<string, string | number>>; }
export interface FiscalCertificateSeat {
  /** The card, as JSON the host passes on unread. */
  read(deps: { db: Database; nodeId: string; locationId: string;
    nameOf(tx: Transaction, personId: string): Promise<string | null> }, now: Date): Promise<Readonly<Record<string, unknown>>>;
  /** Every check, then one write; a refusal is an answer, not a throw. Throws only for the request itself. */
  install(deps: { db: Database; ring: KeyRing; nodeId: string; locationId: string; environment: DeploymentEnvironment;
    authorize(tx: Transaction): Promise<{ personId: string }>; log?: FiscalDutyLog }, body: unknown, now: Date): Promise<FiscalCertificateAnswer>;
}
// on FiscalContribution:
readonly certificate?: FiscalCertificateSeat;
```
Tasks 9b and 10a add `alerts` and `reminders` to `FiscalCertificateSeat` and the slot in the same
task, so the seat is always complete.

- [ ] **Step 1: failing tests.** `contribution.test.ts`: `a contribution can leave the certificate
  seat out` (type-level `Pick<FiscalContribution, "id" | "certificate">` with `certificate:
  undefined`). `slot.test.ts` (new `describe("FISCAL_SLOT.certificate")`, `TEST_MIGRATIONS`):
  `read answers the card for the asking node` (after a setup seal) and `install refuses a wrong
  passphrase without reaching the network` (no transport needed: the refusal comes before the
  check) — asserting the answer and that the revision is unchanged.
- [ ] **Step 2: run, see them fail.**
- [ ] **Step 3: implement**: the types; in `slot.ts`, `certificate: { read: (deps, now) =>
  readCertificateCard(deps, now), install: (deps, body, now) => installCertificate(deps, body, now) }`.
- [ ] **Step 4: run** `pnpm --filter @waitron/fiscal exec vitest run` (includes the vocabulary
  guard) and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/slot.test.ts`;
  `pnpm --filter @waitron/composition exec vitest run`; typecheck `@waitron/fiscal`,
  `@waitron/fiscal-verifactu`, `@waitron/module`, `@waitron/server`. `packages/fiscal` is
  mutation-tested; this adds types only, so it adds no mutants.
- [ ] **Step 5: commit** `git commit -s -m "Give the fiscal slot a certificate seat, so the server can show and install the regime's certificate without naming it (A795)"`

---

## Task 6a: `GET` and `POST /management-api/fiscal-certificate`

**Files:**
- Create: `apps/server/src/fiscal-certificate-api.ts`, `apps/server/src/fiscal-certificate-api.test.ts`
- Modify: `apps/server/src/errors.ts` (`"fiscal.certificate_not_used": Record<string, never>`,
  `"fiscal.certificate_too_large": Record<string, never>`)

**Interfaces — Consumes:** Task 5's seat (`Pick<FiscalCertificateSeat, "read" | "install">`);
`authorizeManager`, `persons` from `@waitron/identity`; `createErrorBoundary`, `readJsonBody`,
`requireManagementSession` from `@waitron/server-kit`; `bodyLimit` from `hono/body-limit` (as
`apps/server/src/cloud-api.ts:62-68`). **Produces:**
```ts
export interface FiscalCertificateApiDeps { db: Database; ring: KeyRing; seat: Pick<FiscalCertificateSeat, "read" | "install">;
  nodeId: string; locationId: string; environment: DeploymentEnvironment; filing(): boolean; now(): Date; }
export function mountFiscalCertificateApi(app: Hono, deps: FiscalCertificateApiDeps, log: Logger): void;
```
- `GET /management-api/fiscal-certificate`: `authorizeManager` with `fiscal.view` in a
  transaction; answers `{ filing: deps.filing(), ...(await seat.read({ db, nodeId, locationId, nameOf }, now)) }`,
  `nameOf` reading `persons.displayName`.
- `POST /management-api/fiscal-certificate`: `bodyLimit({ maxSize: 200_000, onError: (c) => c.json({ error: { code: "fiscal.certificate_too_large", params: {} } }, 413) })`;
  `requireManagementSession`; refuses `fiscal.certificate_not_used` (409) when `!deps.filing()`
  (after authorising); answers `200` with the seat's answer, passing
  `authorize: (tx) => authorizeManager(tx, { managementSessionId, permission: "system.manage" }).then(s => ({ personId: s.authorizedBy }))`
  and `log`.
- Error map: `management_session.required` 401, `management_session.expired` 401,
  `person.suspended` 403, `authorization.not_permitted` 403, `fiscal.certificate_not_used` 409,
  `fiscal.certificate_changed` 409, `fiscal.certificate_request_invalid` 400; tag
  `fiscal_certificate.failed`.

- [ ] **Step 1: failing tests** (model the venue and sessions on `apps/server/src/email-settings-api.test.ts:1-80`; a fake seat built with `vi.fn`):
  - `a manager reads the card with filing true`; `an admin reads it`; `a supervisor is refused
    403 authorization.not_permitted`; `no session is 401`.
  - `a manager's POST reaches the seat with the body and a working authorize` — the fake's
    `install` calls `deps.authorize(tx)` inside `withTransaction` and returns `{ personId }` of the
    manager; the route answers the fake's answer with 200.
  - `a person without system.manage is refused before the seat is called` (seat not called).
  - `a session revoked during the check is refused when the seat re-authorises` (Review Focus 1:
    the fake ends the session between its two `authorize` calls; 401, nothing else).
  - `a body over 200 000 bytes is 413 fiscal.certificate_too_large and never reaches the seat`.
  - `refuses fiscal.certificate_not_used on a box that does not send records` (`filing: () => false`).
  - `fiscal.certificate_changed from the seat is 409`.
  - `no response or log line carries the passphrase or the file` (capture the logger).
- [ ] **Step 2: run, see them fail:** `pnpm --filter @waitron/server exec vitest run src/fiscal-certificate-api.test.ts`
- [ ] **Step 3: implement.**
- [ ] **Step 4: run green;** `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/module-seams.test.ts`; typecheck, lint, format.
- [ ] **Step 5: commit** `git commit -s -m "Let managers read and replace the AEAT certificate through the management API (A795)"`

---

## Task 6b: Mount the routes in boot; the real seat through the route

**Files:**
- Modify: `apps/server/src/boot.ts` (beside `mountEmailSettingsApi`, about line 1782)
- Create: `apps/server/src/fiscal-certificate-api.verifactu.test.ts`

- [ ] **Step 1: failing tests:**
  - With the real `FISCAL_SLOT.certificate` seat (imported in the TEST only, as
    `fiscal-readiness-runner.verifactu.test.ts` does): `a wrong passphrase through the route is
    refused under the passphrase field and leaves the vault unchanged` — a fixture candidate from
    `@waitron/fiscal-verifactu/test/certificate-fixtures.js`; answer `{ outcome: "refused",
    reason: "passphrase_wrong", field: "passphrase" }`; `credentialRevision` unchanged; the log has
    `fiscal.certificate_refused` with `{ reason: "passphrase_wrong", field: "passphrase" }` only.
  - `GET through the route shows the setup-installed certificate with the installer null`.
  - In `apps/server/src/boot.test.ts`'s style (read it first; reuse its booted-server helper): `a
    trading box with the Veri*Factu module serves GET /management-api/fiscal-certificate`, and a
    box whose fiscal module is `fiscal-none` answers 404 there. If booting costs more than the
    existing helper makes cheap, assert the mount through the same helper the email settings
    route's boot case uses; do not add a new boot.
- [ ] **Step 2: run, see them fail.**
- [ ] **Step 3: wire in boot**, only when `enabledFiscal.certificate !== undefined`:
  `mountFiscalCertificateApi(app, { db, ring, seat: enabledFiscal.certificate, nodeId: till.nodeId,
  locationId: till.locationId, environment: config.environment, filing: () =>
  fiscalDrainEnabled(config) && holders.singletonRole.current === "primary", now }, log)`.
  `fiscalDrainEnabled` from `./onboarding-policy.js`. A read-only mirror already refuses
  management writes (`apps/server/src/read-only-gate.ts`); do not add another gate.
- [ ] **Step 4: run** both new files, `src/boot.test.ts`, `src/read-only-gate.test.ts` if present,
  and `pnpm exec vitest run scripts/module-seams.test.ts` (apps/server source must not import the
  regime; only the test does).
- [ ] **Step 5: commit** `git commit -s -m "Mount the AEAT certificate routes on a trading box with the Veri*Factu module (A795)"`

---

## Task 7: A dashboard contribution may bring only settings panels

**Files:**
- Modify: `packages/dashboard-kit/src/contract.ts`, `packages/dashboard-kit/src/index.ts`
- Create: `packages/dashboard-kit/src/contract.test.ts` (or add to an existing contract test if one exists)
- Modify: `apps/dashboard/src/dashboard-app.ts:1388-1442, 1946-1951, 2108-2113`
- Create: `apps/dashboard/src/dashboard-app.panel-only.test.ts`

**Interfaces — Produces:**
```ts
interface DashboardContributionBase { module: string; strings: { en: Record<string, string>; es: Record<string, string> };
  moreScreens?: readonly DashboardFurtherScreen[]; settingsPanels?: readonly DashboardSettingsPanel[];
  calendarViews?: readonly DashboardCalendarView[]; searchDestinations?: readonly DashboardSearchDestination[]; }
export type DashboardContribution = DashboardContributionBase &
  (DashboardFurtherScreen | { screen?: undefined; create?: undefined });
/** The contribution's own screen, if it brings one, then its further screens. */
export function contributedScreens(c: DashboardContribution): readonly DashboardFurtherScreen[];
```

- [ ] **Step 1: failing tests:** `contributedScreens` returns `[c, ...moreScreens]` for a
  contribution with a screen and `[]` for a panel-only one. In
  `dashboard-app.panel-only.test.ts` (copy the `vi.mock("@waitron/dashboard-modules")` shape of
  `apps/dashboard/src/dashboard-app.settings-panels.test.ts:36-67` into the new file; do not edit
  that file): a module with `settingsPanels` on `"venue-details"` and no `screen` is activated
  without throwing, its panel renders on Venue settings after the core panels (`order: 1`), and the
  nav, search and the address-keeping list gain no entry for it.
- [ ] **Step 2: run, see them fail:** `pnpm --filter @waitron/dashboard-kit exec vitest run src/contract.test.ts` and `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.panel-only.test.ts`
- [ ] **Step 3: implement**; replace each `[c, ...(c.moreScreens ?? [])]` in `dashboard-app.ts`
  with `contributedScreens(c)`.
- [ ] **Step 4: run** the two new files plus `src/dashboard-app.settings-panels.test.ts`,
  `src/dashboard-app.module-screens.test.ts`, `src/dashboard-app.module-order.test.ts`,
  `src/dashboard-app.search-destinations.test.ts`, and
  `pnpm --filter @waitron/dashboard-modules exec vitest run` — all unedited; typecheck
  `@waitron/dashboard-kit`, `@waitron/dashboard`, `@waitron/dashboard-modules` and every package
  with a `src/dashboard/index.ts` (they build `DashboardContribution` values).
- [ ] **Step 5: commit** `git commit -s -m "Let a module add Venue settings panels without bringing a page of its own (A795)"`

---

## Task 8a: Browser project, CI, client, strings, the card

**Files:**
- Modify: `packages/fiscal-verifactu/vitest.config.ts` (two projects, the `packages/media/vitest.config.ts` shape: node project `include: ["src/**/*.test.ts"]`, `exclude: [...configDefaults.exclude, "**/.stryker-tmp/**", "src/dashboard/**"]`; browser project `include: ["src/dashboard/**/*.test.ts"]`, `fileParallelism: false`, `browser: { enabled: true, provider: playwright({}), headless: true, instances: [{ browser: "chromium" }], commands: { ...parkPointerCommands } }`; outer `maxWorkers: 4`, `testTimeout`/`hookTimeout` and `coverage` unchanged)
- Modify: `packages/fiscal-verifactu/package.json` (dependencies `@waitron/dashboard-kit`, `@waitron/ui`, `lit` `^3.2.0`; devDependencies `@vitest/browser-playwright` `^4.1.11`, `playwright` `^1.64.1`, as `packages/adjustments/package.json`)
- Modify: `.github/workflows/ci.yml` job `test-fiscal-verifactu` (line 934): after `pnpm install --frozen-lockfile`, the three Playwright steps exactly as `test-adjustments` has them (resolve version, cache `~/.cache/ms-playwright`, `pnpm --filter @waitron/fiscal-verifactu exec playwright install chromium`)
- Create: `packages/fiscal-verifactu/src/dashboard/{index.ts,client.ts,strings.ts,certificate-card.ts,certificate-card.test.ts,vite-env.d.ts}`
- Modify: `packages/dashboard-modules/package.json` (dependency `@waitron/fiscal-verifactu`), `packages/dashboard-modules/src/index.ts`, `packages/dashboard-modules/src/registry.test.ts` (a NEW case only)

**Interfaces — Produces:**
```ts
// client.ts — a LOCAL copy of the JSON shapes; never imports server code (a browser bundle)
export interface CertificateCardView { filing: boolean; revision: string | null; timeZone: string; installed: null | {…Task 4b's fields…} }
export interface InstallBody { pfxBase64: string; passphrase: string; certKind: "sello" | "representante"; expectedRevision: string | null }
export interface InstallAnswerView { outcome: "installed" | "refused"; reason: string; field?: "file" | "passphrase"; details?: Record<string, string | number> }
export class AeatCertificateClient { constructor(request: DashboardRequest);
  read(): Promise<CertificateCardView>;            // GET, { passive: true }
  install(body: InstallBody): Promise<InstallAnswerView>; }   // POST
// index.ts
export const VERIFACTU_DASHBOARD: DashboardContribution = { module: "fiscal-verifactu", strings,
  settingsPanels: [{ id: "aeat-certificate", tab: "venue-details", order: 1,
    requiresPermission: "system.manage", readPermission: "fiscal.view", create(ctx) {…} }] };
// certificate-card.ts: <dashboard-aeat-certificate-card .client .readOnly>
```
`packages/dashboard-modules/src/index.ts` imports `VERIFACTU_DASHBOARD` from
`@waitron/fiscal-verifactu/src/dashboard/index.js` (decision 6) and appends it to
`DASHBOARD_MODULES`. `src/dashboard/` imports nothing from the package's Node files; it must load in
Node too, because `packages/dashboard-modules`' Node tests import it (as they import
`packages/adjustments/src/dashboard/index.ts`).

Strings (`strings.ts`, `registerCatalogue` at load, keys prefixed `aeat_certificate.`): every card
string of design §7 (title, rows, "matches the business", "not shown on the certificate", the four
days forms, the three "installed by" forms, "None since it was installed", both buttons, "none
installed", "not filing", both warning lines, the red line, the installed line) plus decision 14's
expired line and "does not match the business", and the type names reused from setup
("Company seal (sello)" / "Sello electrónico", "Representative (representante)" / "Representante").

- [ ] **Step 1: failing tests, `certificate-card.test.ts`** (a stub client; the mockups are the
  reference for layout: `01`, `02`, `03`, `11`, `15`):
  - `shows every row for a healthy certificate` (mockup 01's values: "BAR LUCÍA S.L.", "B12345678 · matches the business", "Representative (representante)", "AC Representación (FNMT-RCM)", "3 Oct 2025", "3 Oct 2027 · 350 days left", "14 Nov 2025, 10:12 · during setup", last accepted).
  - `shows the amber line by type`: a seal's and a representative's warning lines differ (§7).
  - `shows the red line with the days`; `shows the expired line`; `says Expires tomorrow, 01:30 the
    day before and Expires today, 01:30 on the day` in the venue zone (E9 instants).
  - `shows "not shown on the certificate" and "—" when the certificate carries neither`.
  - `says no certificate is installed and offers Install certificate`; `says the box needs none
    and offers no button when filing is false`; `shows "Installed: not recorded" with Replace
    certificate when the vault has one but no row`.
  - `offers no button when read-only` (a `fiscal.view`-only person).
  - `reads the card passively` (the stub's `read` is called with the client's passive GET — assert
    the `DashboardRequest` stub got `{ passive: true }`).
  - `shows a load failure, not an empty card, when the read fails`.
  - `renders in Spanish` (mockup 15) — `setLocale("es-ES")`, restored in `afterEach` (CLAUDE.md §4).
- [ ] **Step 2: run, see them fail:** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/certificate-card.test.ts`
  (check free memory first: `memory_pressure | grep free`).
- [ ] **Step 3: implement** the card, styled like `apps/dashboard/src/screens/venue-details-panel.ts`
  (a titled card, a `<dl>` of rows, the action button at the trailing edge), the status line as a
  `wt-notice` or `wt-banner` in the stage's colour. The button dispatches nothing yet (Task 8b
  opens the dialog).
- [ ] **Step 4: registry case** in `packages/dashboard-modules/src/registry.test.ts`: `puts the AEAT
  certificate on Venue details for system.manage, readable with fiscal.view` →
  `[["venue-details", "system.manage", "fiscal.view", 1]]` from the fiscal-verifactu
  contribution's panels.
- [ ] **Step 5: run** the card file, `pnpm --filter @waitron/dashboard-modules exec vitest run`,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project node src/slot.test.ts` (the
  Node project still runs), `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/fiscal-test-budget.test.ts scripts/workspace-cycles.test.ts scripts/module-seams.test.ts scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/english-only.test.ts scripts/coverage-thresholds.test.ts`,
  and `pnpm --filter @waitron/dashboard build` (proves the bundle takes the module without Node
  code). Typecheck `@waitron/fiscal-verifactu`, `@waitron/dashboard-modules`, `@waitron/dashboard`.
- [ ] **Step 6: commit** `git commit -s -m "Show the AEAT certificate on Venue settings: who it is for, its dates, who installed it and AEAT's last acceptance (A795)"`

---

## Task 8b: The Replace dialog and the export guides

**Files:**
- Create: `packages/fiscal-verifactu/src/dashboard/certificate-dialog.ts`, `certificate-dialog.test.ts`, `export-guides.ts` (import-free data: the three guides' ids, FNMT links copied from `apps/setup/src/certificate-export-help.ts:5-24`, and `{ en, es }` for every `cert_help.*` key)
- Modify: `packages/fiscal-verifactu/src/dashboard/certificate-card.ts`, `strings.ts`
- Create: `scripts/certificate-export-guides.test.ts` (root guard: for every `cert_help.*` key, `venueEn`/`venueEs` from `apps/setup/src/i18n/strings/venue.ts` equal `export-guides.ts`'s English/Spanish, and the three links are equal)

The dialog (`<dashboard-aeat-certificate-dialog>` in a `wt-dialog`, mockups 04–10, 16):
- Fields, all `required`: `wt-file-input` `name="certificate-file"` `accept=".pfx,.p12"` with the
  setup label "Certificate file (.pfx or .p12)"; `wt-input` `name="certificate-passphrase"`
  `type=password` with a Show/Hide `wt-button` in the `end` slot (the dashboard's own pattern,
  `apps/dashboard/src/widgets/email-settings-form.ts:251-275`); `wt-combobox`
  `name="certificate-kind"` pre-set to the card's kind, else `sello` (decision 13). Under them a
  `wt-disclosure` holding the export guides.
- Save (`wt-form-actions`, "Save"): `draftScopeFor` + `saveActionState`
  (`packages/ui/src/leave-controller.ts:115,141`): quiet and disabled until a file is chosen; while
  a save is in progress (label "Checking with AEAT…"); and after a failed Save while one of the
  form's own checks still fails. Pressing Save with the passphrase empty marks it "Enter the
  certificate passphrase." and the bottom says "Correct the highlighted fields to continue."; the
  form re-checks on every change. A file over `100 * 1024` bytes is marked under the file with the
  `too_large` sentence before anything is sent.
- The passphrase is sent exactly as typed (no `trim`) (Review Focus 3).
- An answer `refused` puts its §7 sentence under `field`, or at the bottom when it names none,
  filled from `details` (dates formatted in the venue zone, "1 Oct 2026"); it never disables Save,
  and stays until that field changes or Save is pressed again. Request errors (registered with
  `registerCodeMessages`, both languages): `fiscal.certificate_changed` → §7 "changed" sentence at
  the bottom; `fiscal.certificate_too_large` → the `too_large` sentence under the file;
  `fiscal.certificate_not_used` → "This box does not send records to AEAT, so it needs no
  certificate." / the §7 Spanish; `fiscal.certificate_request_invalid` → "Waitron could not read
  this request. Choose the file again and try again." / "Waitron no ha podido leer esta solicitud.
  Vuelve a elegir el archivo e inténtalo de nuevo."; a failed connection → the house
  `connection.failed` message.
- On `installed`: commit the draft scope, close the dialog, and the card shows the green installed
  line ("Installed. AEAT answered a check with this certificate at {time}. …", time from
  `details.checkedAt` in the venue zone) and re-reads. If that re-read fails, the card shows a load
  failure and the dialog stays closed (Review Focus 5; CLAUDE.md §3 "A successful write followed by
  a failed refresh is a load failure").
- The request carries `expectedRevision` = the card's `revision` when the dialog opened.

- [ ] **Step 1: failing tests, `certificate-dialog.test.ts`** — one per bullet above, with a stub
  client: Save disabled before a file; `Checking with AEAT…` while pending; empty passphrase marks
  the field and the bottom; a 102 400-byte file is marked without a request; the body sent equals
  `{ pfxBase64: <base64 of the bytes>, passphrase: " cert pass 9 ", certKind: "representante", expectedRevision: "rev-1" }`;
  each refusal reason lands under the right field with the §7 English sentence (E2 passphrase, E3
  other taxpayer "This certificate is for tax ID B87654321, not B12345678.", E4 "This certificate
  expired on 1 Oct 2026.", E5 closed at the bottom, E6 old encryption); Save stays enabled after a
  refusal; each request error's sentence and place; success closes and the card shows the
  installed line; success then a failed re-read shows a load failure on the card. Use
  `userEvent.click` where a click's outcome depends on an update a listener schedules (CLAUDE.md §4)
  and wait for `wt-close` before asserting what the card does on close.
- [ ] **Step 2: run, see them fail** (`pnpm --filter @waitron/fiscal-verifactu exec vitest run src/dashboard/certificate-dialog.test.ts`) and the root guard red.
- [ ] **Step 3: implement**; the card's button opens the dialog.
- [ ] **Step 4: run** the dialog and card files, `pnpm exec vitest run scripts/certificate-export-guides.test.ts scripts/native-form-fields.test.ts scripts/help-tooltip-mode.test.ts scripts/style-token-names.test.ts`; typecheck, lint, format.
- [ ] **Step 5: commit** `git commit -s -m "Replace the AEAT certificate from its card: a checked form that explains each refusal where it belongs (A795)"`

---

## Task 8c: Accessibility, unsaved changes, and a look at both themes and phone width

**Files:**
- Create: `packages/fiscal-verifactu/src/dashboard/certificate-card.a11y.test.ts`, `certificate-dialog.a11y.test.ts`, `certificate-dialog.unsaved.test.ts`

- [ ] **Step 1: tests:** axe with `expectNoA11yViolations`/`mountThemed` from
  `@waitron/ui/src/a11y-helpers.js` (as `packages/adjustments/src/dashboard/reasons-screen.a11y.test.ts`)
  for the card in each state (healthy, amber, red, expired, none, not filing) and the dialog in each
  state (empty, filled, checking, a field refusal, a bottom refusal), each in light and dark. The
  unsaved test follows an existing `*.unsaved.test.ts` (`packages/payments-sumup/src/dashboard/sumup-connect-form.unsaved.test.ts`):
  closing a dialog with a chosen file asks to discard; an untouched dialog closes at once; after a
  successful install nothing is asked.
- [ ] **Step 2: run them;** fix the component, not the test, when one fails.
- [ ] **Step 3: LOOK.** A throwaway browser test (never committed; delete it before the commit)
  mounts the card and the dialog with mockup data, sets the viewport to 390 × 844 and to
  1280 × 900, in light and in dark, and saves screenshots under `$TMPDIR/a795-look/`; open each PNG
  with the Read tool and compare with mockups 01, 02, 03, 04, 05, 06, 07, 10, 11. Check: nothing
  clipped or overlapping at 390 px, the button wraps under the title where mockup 02 shows it, the
  dialog's footer stays reachable, the status line colours read in dark. Fix and re-look. Report
  what was looked at in the commit message body.
- [ ] **Step 4: run** the whole browser project once:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser` (check free memory
  first), then `pnpm --filter @waitron/fiscal-verifactu test:coverage` and read the per-file table
  for the new files.
- [ ] **Step 5: commit** `git commit -s -m "Check the AEAT certificate card and dialog for accessibility in both themes, and guard unsaved changes (A795)"`

---

## Task 9a: The `{name:date}` alert slot and the alert wording

**Files:**
- Modify: `packages/dashboard-kit/src/alert-messages.ts`, `packages/dashboard-kit/src/alert-messages.test.ts` (new cases)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts:202-205` and add the two new codes
- Modify: `apps/server/src/alert-sources.ts:315-321` (`screen: "venue-settings"` on `fiscal.awaiting_certificate`), `apps/server/src/alert-sources.test.ts` (new case)

- [ ] **Step 1: failing tests:** `alertMessage` with `"On {when:date}."` and `{ when: "2026-10-25" }`
  → `"On 25 Oct 2026."` for `"en"` and `"en-GB"`, `"25 oct 2026"` inside for `"es"` and `"es-ES"`;
  a value that is not `YYYY-MM-DD` writes `—`. Measured 2026-10-18 on Node v26.11.1:
  `Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })`
  gives `Oct 25, 2026` but `en-GB` gives `25 Oct 2026`, and `es`/`es-ES` both `25 oct 2026` — so
  format with `en-GB` or `es-ES` by the alert's language, reading the date at UTC midnight. A
  registered word list named `date` would be shadowed; none exists (`git grep registerAlertWords`).
  `apps/server`: `fiscal.awaiting_certificate links to Venue settings` (`screen: "venue-settings"`).
- [ ] **Step 2: implement**; wording exactly design §7 for `fiscal.certificate_expiring`,
  `fiscal.certificate_expired` and the reworded `fiscal.awaiting_certificate` (English and Spanish).
- [ ] **Step 3: run** `pnpm --filter @waitron/dashboard-kit exec vitest run src/alert-messages.test.ts`,
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/alerts.test.ts`,
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts`.
- [ ] **Step 4: commit** `git commit -s -m "Alerts can show a date in the reader's language; certificate alert wording, and the missing-certificate alert links to Venue settings (A795)"`

---

## Task 9b: The expiry alert source

**Files:**
- Create: `packages/fiscal-verifactu/src/certificate-alerts.ts`, `certificate-alerts.test.ts`
- Modify: `packages/fiscal/src/contribution.ts` (seat gains `alerts`), `packages/fiscal-verifactu/src/slot.ts`, `src/errors.ts` (the two ongoing codes, "never thrown", as `fiscal.submission_delayed` at `errors.ts:300-304`)
- Modify: `apps/server/src/alert-sources.ts` (`certificateAlertSource`), `apps/server/src/alert-sources.test.ts` (new cases), `apps/server/src/boot.ts:1997-2016`
- Modify (Changed test checks): `scripts/ongoing-alert-codes.test.ts` `ONGOING_CODE_SOURCES`

**Interfaces — Produces:**
```ts
// packages/fiscal: on FiscalCertificateSeat
alerts(tx: Transaction, deps: { nodeId: string; locationId: string }, now: Date): Promise<readonly {
  key: string; code: string; params: Readonly<Record<string, unknown>>; severity: "warning" | "error";
  since: string | null; screen?: string }[]>;
// fiscal-verifactu
export async function certificateAlerts(tx, deps, now): Promise<OngoingAlert[]>;  // structurally the type above
// apps/server
export function certificateAlertSource(seat: Pick<FiscalCertificateSeat, "alerts">, deps: { nodeId: string; locationId: string }): AlertSource; // area "fiscal", permission "fiscal.view"
```
Rules: the latest install for `nodeId` only; none → `[]`. Stage from Task 1 with the row's kind and
`validUntil` in the venue zone. `warning` → `{ key: "fiscal.certificate_expiring", code:
"fiscal.certificate_expiring", params: { days, date }, severity: "warning", since: stageSince(...),
screen: "venue-settings" }`; `urgent` → the same code with `severity: "error"`; `expired` →
`{ key/code "fiscal.certificate_expired", params: { date }, severity: "error", since: validUntil ISO, screen: "venue-settings" }`.
`date` is the venue-local `YYYY-MM-DD` of `validUntil`. Each `code:` is a double-quoted literal in
this file (the guard reads `code: "…"`, `scripts/ongoing-alert-codes.test.ts:18`).

- [ ] **Step 1: failing tests** with E8's dates (representative ending `2026-10-24T22:59:00Z`):
  none at 25 Aug; warning `{ days: 60, date: "2026-10-25" }` since `2026-08-25T22:00:00.000Z` at
  26 Aug; error at 11 Oct; expired `{ date: "2026-10-25" }` since `2026-10-24T22:59:00.000Z` at
  `2026-10-24T23:00:00Z`; a seal warning from 27 Jul; another node's row raises nothing; no row
  raises nothing. `apps/server`: the wrapper passes `nodeId`/`locationId` and stamps area and
  permission.
- [ ] **Step 2: run, see them fail.**
- [ ] **Step 3: implement; wire in boot** — push `certificateAlertSource(enabledFiscal.certificate, { nodeId: till.nodeId, locationId: till.locationId })`
  onto `serverAlertSources` only when the seat exists and `fiscalDrainEnabled(config)` (decision 5).
  Add the file to `ONGOING_CODE_SOURCES`.
- [ ] **Step 4: run** the new tests, `pnpm --filter @waitron/fiscal exec vitest run`,
  `pnpm --filter @waitron/server exec vitest run src/alert-sources.test.ts src/alerts.test.ts src/alerts.brake-probe.test.ts`,
  `pnpm exec vitest run scripts/ongoing-alert-codes.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`.
- [ ] **Step 5: commit** `git commit -s -m "Warn on the dashboard as the AEAT certificate nears expiry, by type, and when it has expired (A795)"`

---

## Task 10a: Reminder claims and wording

**Files:**
- Create: `packages/fiscal-verifactu/src/certificate-reminders.ts`, `certificate-reminders.test.ts`
- Modify: `packages/fiscal/src/contribution.ts` (seat gains `reminders`), `packages/fiscal-verifactu/src/slot.ts`

**Interfaces — Produces:**
```ts
// packages/fiscal: on FiscalCertificateSeat
reminders: {
  claim(tx: Transaction, deps: { nodeId: string; locationId: string },
    recipients: readonly { personId: string; email: string; language: "en" | "es" }[], now: Date):
    Promise<{ id: string; recipient: string; subject: string; text: string } | null>;
  report(tx: Transaction, id: string, outcome: "sent" | "rejected" | "unknown", now: Date): Promise<void>;
};
```
Rules: the latest install for `nodeId`; its stage now (Task 1); none → `null`. The first recipient
(ordered by `personId`) with no row for `(install, stage, person)`, or whose row is `failed` and was
reported more than 24 hours ago, gets a row `claimed` (insert, or update of the failed row) and is
returned. `report`: `sent` → `sent`, `rejected` → `failed`, `unknown` → `unknown`, with
`reported_at`. A `claimed` or `unknown` row is never claimed again (decision 9).
Wording (dates as Task 9a formats them, `en-GB`/`es-ES`):
- warning and urgent — subject "AEAT certificate expires on {date}" / "El certificado de la AEAT caduca el {date}"; text = design §7's `fiscal.certificate_expiring` sentence with `{date}` and `{days}` filled.
- expired — subject "AEAT certificate expired on {date}" / "El certificado de la AEAT caducó el {date}"; text = §7's `fiscal.certificate_expired` sentence.

- [ ] **Step 1: failing tests:** nothing to send outside a stage; one claim per recipient per
  stage (a second claim in the same stage returns the next recipient, then `null`); moving from
  warning to urgent claims again; `rejected` is claimed again only after 24 hours; `unknown` and a
  left-over `claimed` are never claimed again; the Spanish recipient gets the Spanish subject and
  text with "25 oct 2026"; another node's install yields nothing; no email address is written to
  the table (`select * from fiscal_certificate_reminders` has no column holding it).
- [ ] **Step 2: run, see them fail. Step 3: implement. Step 4: run** the file, `src/slot.test.ts`,
  `pnpm --filter @waitron/fiscal exec vitest run`; typecheck, lint, format.
- [ ] **Step 5: commit** `git commit -s -m "Decide which certificate expiry emails are due and record each one, at most once per person and stage (A795)"`

---

## Task 10b: The reminder email loop

**Files:**
- Create: `apps/server/src/certificate-reminder-worker.ts`, `certificate-reminder-worker.test.ts`, `apps/server/src/certificate-reminder-email.ts`, `certificate-reminder-email.test.ts`
- Modify: `apps/server/src/boot.ts` (beside the attendance email loop, about line 1632)

**Interfaces — Produces** (modelled on `apps/server/src/attendance-email-worker.ts:18-149` and `attendance-email.ts`):
```ts
export type CertificateReminderSender = (m: { smtp: { url: string; from: string }; recipient: string; subject: string; text: string }) => Promise<"sent" | "rejected" | "unknown">;
export function createCertificateReminderSender(): CertificateReminderSender; // nodemailer, 30 s timer, 4xx/5xx → rejected, as attendance-email.ts
export interface CertificateReminderPassDeps { db: Database; seat: Pick<FiscalCertificateSeat, "reminders">;
  nodeId: string; locationId: string; venueLanguage: "en" | "es"; now(): Date; isPrimary(): boolean;
  signal: AbortSignal; resolveDelivery(): Promise<EmailDelivery>; send: CertificateReminderSender; }
export async function runCertificateReminderPass(deps): Promise<{ processed: boolean }>;
export async function runCertificateReminderLoop(deps & { onError(e: unknown): void; sleep?: … }): Promise<void>; // 500 ms after work, 3 600 000 ms idle
```
A pass: skip unless `isPrimary()`; skip when delivery is `unconfigured`; recipients = `persons`
with `status "active"`, a non-blank email, and `roleHasPermission(role, "system.manage")`
(`packages/identity/src/permissions.ts:130`), language `es` for `locale "es-ES"`, `en` for
`"en-GB"`, else the venue's; claim in one transaction, send outside it, report in another.

- [ ] **Step 1: failing tests:** a manager and an admin each get one email at amber and none on the
  next pass; a supervisor and a suspended manager get none; nothing is sent without SMTP, on a
  non-primary, or after the signal aborts; a rejected send is reported `failed`; a throwing sender
  is reported `unknown`; the sender builds a message with the given subject and text (a fake SMTP
  transport, as `attendance-email.test.ts` does).
- [ ] **Step 2: run, see them fail. Step 3: implement; wire in boot** only when
  `enabledFiscal.certificate` exists and `fiscalDrainEnabled(config)`: start the loop with
  `resolveEmailDelivery(db, ring, config.devMode || till.practiceMode === true)`, its own
  `AbortController`, and push its stop onto `undoOnFailure` as soon as it starts (CLAUDE.md §3,
  "A duty bootServer starts pushes its stop onto undoOnFailure").
- [ ] **Step 4: run** both files, `src/boot.test.ts`, `src/boot.failed-start.test.ts`; typecheck,
  lint, format.
- [ ] **Step 5: commit** `git commit -s -m "Email managers and admins when the AEAT certificate nears expiry and when it expires (A795)"`

---

## Task 11: Docs, backlog, usage text

**Files:** `packages/credentials/src/cli.ts` (`USAGE`), `apps/server/README.md`,
`docs/backlog.md`, `docs/backlog/fiscal.md`, `docs/backlog/setup.md`, and any prose the grep below
finds.

- [ ] **Step 1: usage text** (design §5.9): add to `USAGE` the line `"Writing fiscal.aeat here records no install, so the dashboard's AEAT certificate card keeps showing the previous one."`.
  Run `pnpm --filter @waitron/credentials exec vitest run src/cli.test.ts`.
- [ ] **Step 2: `apps/server/README.md`** (around line 276): the certificate is installed or
  replaced after setup on the dashboard (Venue settings → Venue details → AEAT certificate) or
  through `GET`/`POST /management-api/fiscal-certificate` (`fiscal.view` to read, `system.manage`
  to replace; refused on a box that does not send records); say what the POST checks and that
  `waitron-credentials set --purpose fiscal.aeat` leaves no install record.
- [ ] **Step 3: backlog.** Delete A795's entry in `docs/backlog.md` (line 444 block) and its
  mention in "What a standalone box still lacks" (line 119). In `docs/backlog/fiscal.md` replace
  the A795 section with short open entries, each with a new item number from
  `~/waitron-campaign-shared/next-item-number` (read, use, write back):
  - **Owner-run checks with real certificates before go-live** (design §8; the build cannot run
    them): a consulta to production and with a seal at `www10`; each type at the other type's
    address; how AEAT answers an expired certificate; where a seal keeps the tax ID and whether
    representative certificates carry `organizationIdentifier` and `O`; whether real exports use
    RC2; a non-ASCII passphrase (forge could not build one, §3 above); where an AEAT error number
    arrives in a refused consulta, which decides whether the "AEAT refused ({codigo})" sentence is
    built (decision 11). If any answers differently from the design, the affected part is
    redesigned before landing.
  - **A box set up before A795 shows "Installed: not recorded"** until the certificate is
    installed again (design §3.7) — reset or reinstall; no migration code.
  Update A852 in `docs/backlog/setup.md` (lines 8-28): the opening and date checks now exist as
  `openCertificateFile` (`packages/fiscal-verifactu/src/certificate-file.ts`); A852 reuses it.
- [ ] **Step 4: stale-claim sweep** across the whole base-to-tip range (CLAUDE.md §1):
  `git grep -n -i -e "upload the certificate" -e "only the setup wizard" -e "nothing watches" -e "waitron-credentials set --purpose fiscal.aeat" -e "install the certificate by hand" -e "certificate after setup" -- docs apps packages README.md ':!docs/superpowers'`
  and read `docs/backlog/replication-cloud.md:343-347`, `docs/compliance/first-aeat-contact.md:49-57`
  and `docs/compliance/asesor-questions.md:1842-1849`; correct each claim the build made false,
  with a dated pointer in historical documents rather than a rewrite. `docs/` is not
  format-checked (`pnpm exec prettier --file-info <file>` prints `"ignored": true`); the README is.
- [ ] **Step 5: commit** `git commit -s -m "Docs: the AEAT certificate is installed after setup on the dashboard; open owner checks with real certificates (A795)"`

---

## After the last task

`/finish-branch` with this worktree and this plan: FULL review wave, the Codex run-it seat twice
(risk-trigger branch; the second told to test what the checklist does not name). CI owns the package
suites; read the `changes` job's outputs before calling the branch green. The owner lands it.
