# SETUP-CERT-FIRST piece 1: setup refuses another taxpayer's certificate

Status: plan for approval (lane B, 2026-11-27). Branch `feat/setup-cert-taxpayer-check`. Fiscal: the
owner lands it.

**Owner's ask.** 25 Nov 2026 12:4x, "btw do we ask for the company's registered name? or do we just
extract them from the certificate? should we do the latter?", then "y" to the watcher's two pieces
(lane B `queue.md`, item SETUP-CERT-FIRST). This is piece 1: "setup refuses a certificate whose tax
number is not the venue's, as the dashboard's install does (`other_taxpayer`)... Refuse at the
server before anything is made; the field message on the certificate page."

## What a person can do once it lands

On a live Spanish setup, choosing a certificate issued to another tax number is refused on the
certificate page, under **Certificate file**, before the box makes the venue, its invoice series or
its fiscal identity. Today it is accepted, and the venue then files under the typed number with
another company's certificate. A certificate that carries no tax number goes on as today.

## Today

- `validateSetupAeatCert` (`packages/fiscal-verifactu/src/provisioning-secret.ts:73`) opens the
  file and checks its dates only. It is the regime's `provisioningSecret.validate` seat
  (`packages/fiscal-verifactu/src/slot.ts:103`), declared `validate(raw: unknown)` in
  `packages/fiscal/src/contribution.ts:218-228`, so it never sees the venue's tax number.
- The seat has three callers, and each already holds the venue's typed number:
  `parseProvisionPayload` (`apps/server/src/setup-provision-input.ts:272`, `venue.taxId`, already
  normalised by the country's tax-number check at :109-153); the first-setup activation
  (`apps/server/src/first-fiscal-activation.ts:80`, `state.frozen.request`); and
  `parseFirstSetupSettings` (`packages/provisioning/src/first-setup-settings.ts:20`, called from
  `first-setup-command-deployment.ts:128` with `state.frozen.request` in scope).
- The dashboard's replacement install already refuses `other_taxpayer`
  (`packages/fiscal-verifactu/src/certificate-install.ts:148-151`): `normaliseTaxId(venue tax id)`
  against the certificate's `details.taxId`, skipped when the certificate names none.

## Change

1. **Seat.** `validate(raw: unknown, venue: { taxId: string })` in `contribution.ts`. The three
   callers pass the number they hold; `parseFirstSetupSettings` gains the argument and its caller
   passes `state.frozen.request.taxId`.
2. **Check.** In `validateSetupAeatCert`, after the two date checks (the dashboard's order):
   `details.taxId !== null && details.taxId !== normaliseTaxId(venue.taxId)` throws
   `setup.certificate_refused` `{ field: "pfxBase64", reason: "other_taxpayer" }`. Nothing else
   moves; `sealAeatSecret` is unchanged (it runs after the identity is made, so refusing there
   would leave a half-made venue; `validate` is the guard before minting).
3. **Setup page.** `other_taxpayer` joins `REFUSAL_MESSAGES` (`apps/setup/src/screens/cert-screen.ts:39`)
   with `cert.refusal.other_taxpayer` in English and Spanish (`apps/setup/src/i18n/strings/venue.ts`):
   "This certificate is for a different tax ID from the venue's. Choose the venue's own
   certificate." / "Este certificado es de otro NIF, no del local. Elige el certificado del local."
   `#mapCertificateError` already routes a `pfxBase64` refusal to the certificate page.
4. **Guide** (`apps/server/src/guide/{en,es}/aeat-certificate.md`, `#refusals`): the list of
   refusals under **Certificate file** gains "is for another tax ID", with what to do: choose the
   venue's certificate, or, when the typed tax ID is the wrong one, go **Back** to the venue page and
   correct it (on an interrupted setup the venue's details are fixed, so **Start again**).
5. **Backlog:** no entry exists for piece 1; nothing to delete.

## Decisions for the watcher

- **D1. No tax numbers in the refusal.** The dashboard's message names both numbers because they are
  in its install answer's body. A setup refusal is an `AppError`, whose params the shared error
  boundary writes into the log (`apps/server/src/errors.ts:20-24`), and a certificate's tax number
  has no name on `PERSONAL_LOG_KEYS`; adding one is more than this piece needs. The person sees their typed number on the venue page, and piece 2 makes the certificate the
  source of that number on a live setup anyway.
- **D2. The page's message does not say "go Back".** On an interrupted setup (activation) the
  venue's details are fixed and Back cannot correct them, so one sentence that is right on both paths;
  the guide carries the two ways out (step 4).
- **D3. Test certificates that now mismatch.** The fixture authority issues for `89890001K`
  (`packages/fiscal-verifactu/test/certificate-fixtures.ts:184`). Production-setup tests that type a
  different number (for example `50000000R` in `apps/server/src/setup-email-provision.test.ts:32`)
  will now be refused. Each such test gets a certificate issued for its own number (the fixture's
  existing `organizationIdentifier` option), or its typed number set to the certificate's; no
  assertion changes. Every one is listed in the PR's "Changed test checks" section.

## Tests (failing first)

- `packages/fiscal-verifactu/src/setup-certificate.test.ts`: a certificate for another number is
  refused with `reason: "other_taxpayer"`, `field: "pfxBase64"`; the same number written differently
  (lower case, spaces or hyphens, which `normaliseTaxId` removes) is accepted; a certificate with no
  `organizationIdentifier` is accepted.
- `apps/server/src/setup-certificate.test.ts`: a live provision with a mismatched certificate answers
  `setup.certificate_refused` / `other_taxpayer`, and nothing is made (no taxpayer row, no node
  identity), beside the existing refusal cases there.
- The activation and the command-line paths: one refusing case each, in their existing suites
  (`first-fiscal-activation`'s and `packages/provisioning/src/first-setup-settings.test.ts`).
- `apps/setup/src/setup-certificate-refusal.test.ts`: the refusal shows the new message under the
  file field, in both languages.
- Gates: golden huella and `inmutabilidad` unedited; `scripts/errors-reachable.test.ts`.

Size estimate: about 30 production lines, 120 test lines, the guide's two paragraphs.
