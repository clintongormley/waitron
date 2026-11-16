# Own-account security change emails — implementation plan

**Finish:** After a person changes their own security settings or finishes an emailed password reset, send an English/Spanish notice through the existing mail queue to their current address, after commit. One PR, within three build hours.

**Ask:** Lane K `queue.md`, SECURITY-CHANGE-EMAILS, quoting `docs/backlog.md:1241–1244`: “Tell people by email when their account's security changes (owner, 2026-09-12): password changed, passkey or authenticator added or removed, recovery codes regenerated, email changed, Google login connected or disconnected. No link, one line on what to do if it was not them. Open: notify the OLD address on an email change; wording when an admin made the change; grouping a burst.”

**Authority:** The watcher queued this cut. The firing's opening user message authorises finish-branch and land-branch, not this design. Separate Sol-high draft checked by the driver; Claude's 293-second source review is in Lane K `receipts/security-change-emails/plan-review-report.md`. Reviewed by Claude and cleared by watcher 2026-11-16 07:46 with the three amendments incorporated below. No owner design approval claimed.

## Approach and boundaries

Reuse `enqueueMail`, `MAIL_LIFETIME_MS`, `MailKindOwner` and `runMailPass`. Add `security_change`; `account_action` issues bearer tokens, while existing `email_changed` targets an admin change's old address. Leave both unchanged.

Producers are `packages/identity/src/profile.ts`, `passkey.ts`, `google-oidc.ts` and `account-action.ts` (completed `password_reset` only). Their production callers are `apps/server/src/me-api.ts` and `management-api.ts`, including `/management-api/passkey/register/verify` and the Google callback's link branch. Queue after successful writes and all checks, inside their existing transaction. Preserve authentication, hash work, rollback and route answers.

The owner reads current email/locale at each claim, like `role-membership-mail.ts`; fallback to venue locale, cancel without an address. Email confirmation therefore reaches the new address. The claim commits before transport. No addresses/secrets in queue params or new logs; personal log fields use declared masking keys.

Leave old-address notification, admin-change wording and burst grouping open. Exclude PINs, invitations, reset requests, pending email, enrolment starts, refusals, replays, no-op removals/links and ordinary Google login. No ledger, framework, timer or grouping policy. This is a notice, not takeover protection after an attacker changes the address; state that limit in the PR.

## Build test-first

At each step: write assertions, observe their expected failure, implement minimally, rerun changed files. Keep existing behavioural checks.

1. **Admit the kind.** Add `security_change` in `packages/db/src/schema/outgoing-mail.ts` and the existing notice lifetime of 86400000 ms in `src/outgoing-mail.ts`. Add acceptance/enqueue assertions in their sibling tests; observe the CHECK refusal before regeneration. Run `pnpm --filter @waitron/server migration-baseline rebuild --set core`. Include generated `packages/db/drizzle/0000_baseline.sql`, `meta/0000_snapshot.json`, `meta/_journal.json` and `scripts/migration-baseline-epoch.json`. No hand edits; disclose the required venue reset in the PR's first line.

2. **Queue actual changes.** Add internal `packages/identity/src/security-change-mail.ts`: `queueSecurityChangeMail(tx, { personId, change })`, UUID dedupe key per change, shared lifetime. Call from the four producers for all nine changes. Authenticator finish sends one “set up” notice, including replacement; codes first created there need no regeneration notice. Email confirmation requires a non-null result; passkey add requires the insert. Suppress repeated authenticator removal, Google unlink and identical Google link using stored values/affected rows. Do not add password comparisons or hashing.

   Extend `profile.test.ts`, `passkey.test.ts`, `google-oidc.test.ts` and `account-action.test.ts`: exact person/change/one queued row for each success; no matching row for existing refusal/replay/begin/login/no-op cases. Scope by person/change; assert every queued row has exactly `{ change }` params, with no email. Add no log lines. One producer case covers completed emailed password reset, excluding invitation. One producer rollback test asserts both credential state and queue rollback. Producers own queue assertions; no SMTP mocks.

3. **Deliver the notice.** Add `apps/server/src/security-change-mail.ts`, `i18n/security-change-email.ts` and `security-change-mail.test.ts`. Reuse notice retry delays `[60000,120000,240000,600000]`, longest wait 600000 ms, empty settlement. Read venue name at claim; format existing `mail.queuedAt` with `readVenueTimeZone`, including its UTC fallback. No extra timestamp param. Text identifies venue, completed change and time, without links.

   Recovery sentence, superseding the first wording, dictated by watcher 2026-11-16 08:07 after Claude’s real Google-link/reset/login probe: “If this was not you, sign in, remove any sign-in method you don't recognise and change your password; if you can't sign in, ask a venue administrator to reset your sign-in.” Spanish: “Si no has sido tú, entra, elimina cualquier método de acceso que no reconozcas y cambia tu contraseña; si no puedes entrar, pide a un administrador del local que restablezca tu acceso.” No reset or sign-in mechanism change.

   Owner tests send every change in both languages; assert exact subject/body, recipient and settlement. Delay sending to distinguish change time from send time; change email before claim to check current-address lookup; cover locale fallback and no address. Existing `mail-sender.test.ts` owns transport failures/retries.

   Register the owner in `boot.ts`'s normal and repair sender arrays, including claim abandonment. Keep primary guards and the existing duty. Extend `boot.box-emails.test.ts` and `boot.zone-admission.test.ts`: both registrations, real repair delivery, unchanged secondary refusal and no-other-duty checks. Note the deliberate repair owner-list assertion change in the PR.

## Verification and size

Use `useVenueDb`, existing identity fixtures and server `seedPersons`; follow the sibling mail-owner injected sender. Do not broaden `flushAccountMail`. The shared `testing/authenticator.ts:24` calls the real producer, so its users gain queued notices; retain the helper. Driver search found nine server test files using it, rather than the review's claimed 61; CI tests the package.

Run the named changed files with `pnpm --filter <package> exec vitest run <files>`. Also run server `me-api.test.ts`, `management-api-passkey.test.ts`, `google-oidc.test.ts`, `handover-activation.test.ts`, `management-api.staff-rule2.test.ts` and `mail-sender.test.ts`. Run root `scripts/{schema-constraints,append-only-triggers,behavioural-triggers,starting-migrations,personal-log-params}.test.ts` and fiscal `src/inmutabilidad.test.ts` unchanged. Read test counts; then normal hook, full finish-branch review wave and current-head CI. No whole-package local sweep.

Narrow `docs/backlog.md` to the three open decisions. Update the EN/ES data-protection guide’s existing email-provider list for the new notices; no screen change. Forecast additions/removals: production 260–330/0–15; tests 350–470/0–10; support 0/0; prose 45–55/4–6; generated 6–15/6–15. Roughly 680–930 changed lines including generated output; past 1395 or material scope change, ask the watcher before continuing.
