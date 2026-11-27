# SETUP-CERT-FIRST piece 1: setup refuses another taxpayer's certificate

Status: cleared by the watcher 2026-11-27 09:27 (lane B questions.md), D1–D5 as written with the two changes marked below; revised after one fresh read (its report: `2026-11-27-setup-cert-taxpayer-check.fresh-read.md` beside this page). Branch `feat/setup-cert-taxpayer-check`. Fiscal: the
owner lands it.

**Owner's ask.** 25 Nov 2026 12:4x, "btw do we ask for the company's registered name? or do we just
extract them from the certificate? should we do the latter?", then "y" to the watcher's two pieces
(lane B `queue.md`, item SETUP-CERT-FIRST). This is piece 1: "setup refuses a certificate whose tax
number is not the venue's, as the dashboard's install does (`other_taxpayer`)... Refuse at the
server before anything is made; the field message on the certificate page."

## What a person can do once it lands

On a live Spanish setup, a certificate issued to another company's tax number is refused at the
fiscal test on the certificate page, under **Certificate file**, in plain words that name both
numbers, before the box makes the venue, its invoice series or its fiscal identity.

What changes in practice (fresh read, 2026-11-27): every production setup already needs AEAT's test
service to accept a record signed with this certificate (`apps/server/src/setup-operation-routes.ts:262-266`,
`packages/provisioning/src/fiscal-readiness-runner.ts:145`), and AEAT refuses a holder who is neither
the taxpayer, a registered representative nor a "colaborador social" (error 4112,
`docs/compliance/getting-to-production.md:114`; not re-run). So piece 1 does two things: another
company's certificate is refused earlier and plainly, instead of as an AEAT code after the fiscal
test; and a certificate naming another company, such as an accountancy firm's, which AEAT may accept,
is now refused at setup (a company's own "representante" certificate carries the company's number
and passes), as the dashboard's replacement install already refuses it (D4).

Not checked, as on the dashboard: a certificate that carries no organisation identifier, which is
how a personal certificate looks to the certificate reader (`certificate-file.ts:42-45` reads no
person's number), so a sole trader's personal certificate goes on as today (D5).

## Today

- `validateSetupAeatCert` (`packages/fiscal-verifactu/src/provisioning-secret.ts:73`) opens the
  file and checks its dates only. It is the regime's `provisioningSecret.validate` seat
  (`packages/fiscal-verifactu/src/slot.ts:103`), declared `validate(raw: unknown)` in
  `packages/fiscal/src/contribution.ts:218-228`, so it never sees the venue's tax number.
- The seat has three production callers, and each holds the venue's number as `parseVenue`
  normalised it (`apps/server/src/setup-provision-input.ts:153`): `parseProvisionPayload`
  (`setup-provision-input.ts:274`, `venue.taxId`); the first-setup activation
  (`apps/server/src/first-fiscal-activation.ts:81`, `state.frozen.request.taxId`, a `VenueRequest`
  built by `parseVenue`); and `parseFirstSetupSettings`
  (`packages/provisioning/src/first-setup-settings.ts:20`, called from
  `first-setup-command-deployment.ts:128` with `state.frozen.request` in scope). Every place that
  seals a certificate is preceded by one of these in the same request; configuration imports carry
  no certificate (fresh read).
- The dashboard's replacement install already refuses `other_taxpayer`
  (`packages/fiscal-verifactu/src/certificate-install.ts:148-151`): `normaliseTaxId(venue tax id)`
  against the certificate's `details.taxId`, skipped when the certificate names none.
- On a real Spanish box, leaving the venue page reserves the setup and fixes its details
  (`#claimFirstSetup`, `apps/setup/src/setup-app.ts:1562`); **Back** from the certificate page leads
  to the "details are fixed" page, which offers abandoning the attempt and entering new details
  while the attempt has not reached its module step (`setup-app.ts:1480-1497`, :1999, :3062), and
  otherwise **Start again**.

## Change

1. **Seat.** `validate(raw: unknown, venue: { taxId: string })` in `contribution.ts`. The three
   callers pass the number they hold; `parseFirstSetupSettings` gains the argument and its caller
   passes `state.frozen.request.taxId`. About 12 test fakes declaring `validate: () => {}` still
   compile.
2. **Check.** In `validateSetupAeatCert`, after the two date checks (the dashboard's order):
   `details.taxId !== null && details.taxId !== normaliseTaxId(venue.taxId)` throws
   `setup.certificate_refused` `{ field: "pfxBase64", reason: "other_taxpayer",
   certificateTaxId: details.taxId, taxId: venue.taxId }`. `certificateTaxId` is added to
   `PERSONAL_LOG_KEYS` (`apps/server/src/log-personal-data.ts`), so the log masks it while the
   answer keeps it; the bare `taxId` is already there and is the venue's own (CLAUDE.md §3).
   `sealAeatSecret` is unchanged (it runs after the identity is made); its comment "Validated again
   here because a caller may skip the host's `validate` seat" is narrowed to what it re-checks.
3. **Setup page.** `CertificateRefusal` keeps the two numbers when the reason is `other_taxpayer`;
   `other_taxpayer` joins `REFUSAL_MESSAGES` (`apps/setup/src/screens/cert-screen.ts:39`), filled
   with `format`, in English and Spanish (`apps/setup/src/i18n/strings/venue.ts`), naming both
   choices: "This certificate is for tax ID {certificateTaxId}, not the venue's {taxId}. Choose the
   certificate for {taxId}, or, if the venue's tax ID is wrong, select Back to enter the setup
   details again." / "Este certificado es del NIF {certificateTaxId}, no del {taxId} del local. Elige
   el certificado del {taxId} o, si el NIF del local es incorrecto, selecciona Volver para introducir
   de nuevo los datos." `#mapCertificateError` already routes a `pfxBase64` refusal to this page.
4. **Guide** (`apps/server/src/guide/{en,es}/aeat-certificate.md`, `#refusals`): the refusals under
   **Certificate file** gain "is for another tax ID", and what to do: choose the venue's
   certificate; or, when the venue's tax ID is the wrong one, **Back**, then abandon the attempt and
   enter the details again, or **Start again** once that is no longer offered. Lane C's #4465 (A1571
   PR 1) edits the same section and `contribution.ts`: whoever lands second rebases and keeps both.
5. **Backlog:** no entry exists for piece 1; nothing to delete.

## Decisions for the watcher

- **D1. The refusal names both numbers** (changed after the fresh read), so the person can see which
  side is wrong; the certificate's number goes in a new `PERSONAL_LOG_KEYS` name, as the rule asks.
- **D2. One sentence for both setups,** naming both choices; the guide gives the steps past Back.
- **D3. Tests whose certificate now mismatches.** Applying the check in a throwaway copy failed 49
  cases with `other_taxpayer` (apps/server: `setup-api` 9, `setup-api.throwaway` 10,
  `setup-email-provision` 6, `setup-certificate` 2, `first-fiscal-declared-publication` 1,
  `first-fiscal-hour-readiness` 1; packages/provisioning: `cli-first-setup` 18, `cli-owned-entry`
  2), and 7 direct calls need the new argument (`first-setup-settings.test.ts` 6, fiscal-verifactu
  `setup-certificate.test.ts` 1; `slot.test.ts:244` fails to compile). Each file's certificate is
  issued for the number it types (the fixture's existing `organizationIdentifier` option), or its
  typed number set to the certificate's `89890001K`; no assertion changes. Where a test pins which
  refusal comes first (for example "invalid production publication settings refuse before any venue
  write"), the number is fixed, not the assertion. All listed in the PR's "Changed test checks".
- **D4. A certificate naming another company, such as an accountancy firm's, is refused at setup,**
  as the dashboard already does. A company's own "representante" certificate still passes, because it
  carries the company's tax number in its organizationIdentifier (A795 §2.7; watcher 09:27). Third-party filing
  waits; filing for a third party waits for representatives (asesor Q30, cited in
  `docs/superpowers/specs/2026-10-18-a795-aeat-certificate-after-setup-design.md`).
- **D5. Exact comparison, as the dashboard's.** Known wrong refusals, shared with the dashboard: a
  company type whose last character may be a letter or a digit (`G1234567D` typed, `G12345674` in
  the certificate), and a certificate listing another company's identifier first. With both numbers
  in the message the person types the certificate's form; piece 2 then takes the number from the
  certificate. Personal certificates are not checked (above).

## Tests (failing first)

- `packages/fiscal-verifactu/src/setup-certificate.test.ts`: another number is refused with
  `reason: "other_taxpayer"`, `field: "pfxBase64"` and both numbers; the same number with lower case,
  spaces or hyphens is accepted; a certificate with no organisation identifier is accepted.
- `apps/server/src/setup-certificate.test.ts`: a live setup whose certificate is for another number
  is refused at the fiscal test, and nothing is made (no taxpayer row, no node identity). (Watcher
  09:27: no log-masking case here; the logger's own tests cover masking and
  `scripts/personal-log-params.test.ts` checks the new name is listed.)
- The activation and command-line paths: one refusing case each in their existing suites
  (`apps/server/src/setup-first-fiscal-api*.test.ts`, `packages/provisioning/src/first-setup-settings.test.ts`).
- `apps/setup/src/setup-certificate-refusal.test.ts`: the message, with both numbers, under the file
  field, in both languages.
- Gates: golden huella and `inmutabilidad` unedited; `scripts/errors-reachable.test.ts`,
  `scripts/personal-log-params.test.ts`.

Size estimate: about 45 production lines, 80 new test lines, about 30 changed fixture lines across
8 test files, the guide's two paragraphs.
