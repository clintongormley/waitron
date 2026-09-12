# Faster dashboard login

> **2026-09-12:** this document refers to `.github/instructions/waitron.instructions.md`, which has
> been deleted. Its rules moved to `docs/developers/conventions-ui.md`, `conventions-data.md` and
> `testing-guide.md` — sweep those instead. The original is still readable with
> `git show f5941462:.github/instructions/waitron.instructions.md`.

2026-09-12 owner update: Account setup now asks for one PIN entry, without confirmation.
When you reach Your profile with required details missing, its details editor opens and marks
those fields. See the [user-management update](2026-09-09-user-management-and-account-setup.md)
and the login/profile screen regressions in `apps/dashboard/src/screens/`.

2026-09-11 owner update: [login-flow refinements](../specs/2026-09-11-login-flow-refinements-design.md)
supersede the sign-in choices below where they conflict. Email entry opens password without an
automatic passkey prompt; only opted-in email/method preferences persist, changing accounts clears
them, and recovery uses one emailed-link entry for setup and reset. Manual invitation-code entry is
removed. This document records the earlier design.

Status: implemented with automated validation on the `login-screen` branch. Native passkey prompts
and scanning the QR code with a physical authenticator remain device checks before deployment.

You may sign in several times during a working day. The returning path should take a password
and Enter, or a passkey button and device verification. An authenticator code adds a step only
when your account requires it. Account activation stays separate from ordinary login.

## Agreed behaviour

### First visit and alternative methods

- Start with email, offering browser passkey autofill when supported. Selecting a passkey can
  complete login without Continue. Keep an explicit passkey action for browsers without autofill.
- After a syntactically valid email and Continue, start the passkey ceremony. The public flow is
  identical for pending, active, suspended and unknown accounts; do not fetch account status or
  passkey enrolment to select a screen.
- If the prompt is dismissed, show password, passkey and forgotten-password actions directly,
  without a red error or another method-selection menu. Preserve Google login where configured
  and provide an activation entry for someone with an invitation code.
- Cancellation is a normal navigation outcome. A network/server failure or rejected signed
  assertion still needs an explanatory error. Browser cancellation and timeout are not always
  distinguishable; use a neutral fallback when the browser supplies an ambiguous result.
- Password submission contains no authenticator field. After a correct password, request an
  authenticator code only if enrolled, with an explicit saved-recovery-code alternative. Issue no
  management session or cookie until every required factor succeeds.
- Authenticator enrollment presents the setup URI as a QR code. Keep the long setup key as a manual
  fallback and do not enable the factor until the server verifies a current six-digit code.
- Suspended and unknown accounts receive generic public login failures. Enforce account status
  on the server for password, passkey, Google, activation and reset paths; never reactivate a
  suspended account through recovery. Preserve useful suspension explanations inside an already
  authenticated session where appropriate.

### Returning to this browser

- Keep the last successfully authenticated email and login method in tab memory through logout
  and session expiry. Use the authenticated account's email, not an unverified typed address: a
  discoverable passkey or Google login can select a different account.
- Offer **Remember my email on this device**, unchecked initially. Opting in saves that email and
  method across future visits on this origin; it does not remember credentials or extend a session.
  Keep the selection for that remembered account. Do not silently apply account A's consent to a
  different account B on a shared device.
- A remembered password login opens with the email filled and password field focused. A remembered
  passkey login opens with a prominent passkey button. Skip the email/Continue step in both cases.
  Google can remain a direct action; do not automatically redirect to its provider.
- **Use another account** clears the current attempt and its temporary email/method, showing a
  blank email entry without deleting the saved preference. Suppress that preference for this
  attempt. **Forget this account** also deletes the saved preference. Disabling Remember removes
  its persistent record. Never restore old credentials or errors while switching screens.
- After explicit logout, leave the device passkey prompt closed until you choose to sign in.
  Do not start a modal prompt automatically on session expiry or a remembered-account page either.
  Passive autofill may remain available without opening a modal.
- Storage denial, malformed records and stale methods fall back to ordinary login. A remembered
  method is an untrusted display preference, never proof of identity or current enrolment.

### Activation and forgotten passwords

- Email links open `/manage/account` directly. Validate their token before asking for new
  credentials and obtain the account identity from the server. An email carried in the URL is a
  display hint, not authority. Account links take precedence over remembered details and an
  existing session, as they do today.
- The manual activation path takes email and invitation code, validates them, then shows setup.
  Use one new-password field with a reveal button; remove password confirmation from activation
  and reset forms. Keep the existing till PIN setup and its confirmation.
- Validation alone grants no dashboard access. Recheck token/code, purpose, tenant, status and
  expiry when completing setup. Activate and consume the action atomically, then log in using
  the existing invitation completion behaviour.
- An expired/invalid action offers a replacement-email request. Expose the same acknowledgement
  for pending, active, suspended and unknown addresses. Only eligible pending accounts receive
  invitations. Use server-enforced resend spacing, attempt limits and delivery outside the request's
  observable account-dependent timing. A resend must invalidate the predecessor; concurrent
  requests must not create multiple usable successors.
- Keep password reset separate. A valid reset changes the password and invalidates sessions but
  does not log you in or remove enrolled two-factor protection. Continue into ordinary login with
  the email filled in. Do not save an account preference merely because a reset was requested.
- GET only opens the page. Do not consume an action on navigation or token inspection. Keep tokens
  out of logs, referrers and browser preference storage; retain existing link protections.

## Implementation sequence

For every feature or bugfix, write the behavioural test first, run it and observe the expected
failure, then implement the smallest change and rerun it. Keep existing behavioural assertions
when reorganising fixtures. Do not implement production changes during the planning session.

### 1. Pin the current boundaries and public failures

Read `apps/dashboard/src/screens/login-screen.ts`, `dashboard-app.ts`, `api/client.ts`,
`apps/server/src/management-api.ts`, the Google routes, and Identity's `manager-login.ts`,
`passkey.ts`, `account-action.ts` and `management-session.ts`. Trace consumers before changing
login outcomes, error meanings, event payloads or suspension checks, including `loginManagerById`
and the mirror-bundle flow. Trace `getMe()` and the own-profile response to find the authenticated
email; add it to the session response only if the existing authenticated reads cannot supply it.

Add failing tests for generic public suspended-account failures across password/passkey/provider
paths and for rejection of activation/reset after suspension. Retain authenticated and trusted
server-to-server behaviour deliberately instead of changing a shared error globally. For password
failures, assert equivalent password-hash work for unknown, pending and suspended accounts; a
matching error string alone does not address the early-return timing difference.

### 2. Separate password and second-factor screens

Use the existing password-plus-factor session endpoint for both submissions. On the first
submission, a missing factor after a valid password moves to the factor screen. Keep the password
only in component memory for the second request, which verifies password and factor again. This
avoids introducing a partially authenticated management session or a new challenge table.

Test no session/cookie before factor completion; authenticator success; recovery-code success and
reuse failure; incorrect factor; cancellation/back/account switching; and a password or status
change between requests. Distinguish the initial factor request from a displayed invalid-code
error. Audit password throttling so an expected missing factor is not counted as a bad password,
while invalid passwords and factors remain limited. Introduce a domain error only if needed, after
tracing existing `totp.invalid` consumers; never rename a shipped code.

### 3. Validate activation before credentials and add invitation resend

Add a narrowly scoped POST validation endpoint over the existing account-action records. Share
verification logic with completion: token inspection is non-consuming; manual-code inspection
enforces expiry and records bad attempts in a committed transaction. Return the verified account
email and purpose only after proof succeeds. Keep the proof in component memory and revalidate it
on completion, which remains the single-use boundary. No new general login token is needed.

Add a public invitation-resend endpoint using the existing issuing and email-delivery helpers.
Serialise issuance per account/purpose so invalidating a predecessor and inserting its successor
cannot race. Preserve admin invitation and email-change consumers when sharing helpers.

Test invalid/expired/used/wrong-purpose/wrong-tenant proofs, code exhaustion that survives request
failure, no session from inspection, exactly one completion, resend eligibility and throttling,
concurrent resend/completion, and generic responses. Use real PostgreSQL for race and deployment
role assertions; use PGlite for ordinary deterministic validation tests. Update client API tests,
then the activation/reset browser screens, including direct links and removal of password confirm.

### 4. Add remembered-account shortcuts

Create a small dashboard preference helper for tab memory and opt-in persistent email/method.
Integrate it with confirmed authentication and the shell's logout/expiry handling. Tests cover
account switching, account-specific consent, forgetting, opt-out, rejected/corrupt storage,
refresh/new visit with and without opt-in, and link precedence. Verify no credential, action token,
factor or session identifier enters this preference record.

Test that a passkey selecting account B after typing account A remembers B, and that failed login
never writes a new identity or method. Keep the existing session-expiry, cross-tab logout and
locale assertions. The returning password route must submit with Enter without visiting an email
screen; the returning passkey route must wait for a click after logout.

### 5. Add automatic passkey attempt and browser autofill

Check the installed `@simplewebauthn/browser` API for conditional authentication and cancellation
support before choosing the adapter. Set `autocomplete="username webauthn"` on the real native
email input through the shared input contract; verify forwarding through the shadow root.
Use capability detection and preserve the explicit button fallback.

Only one ceremony may be active. Cancel passive autofill before starting an explicit request;
abort on navigation/disconnection, password submission, account switching and logout. Ignore stale
async results so a dismissed/unmounted screen cannot emit a late login or overwrite another
attempt. Tests must cover cancellation, timeout, unsupported autofill, server failure, duplicate
clicks, late completion and selecting a different account. Preserve required WebAuthn user
verification and server-side credential ownership/status checks.

### 6. Finish the UI contract and validate the branch

Localise all copy in shipped locales. Use visible required markers, semantic input names, correct
autocomplete values, adjacent field errors, the shared error summary, `wt-form-actions`, and
action-specific password-reveal labels. Test real keyboard events, focus after each transition,
and accessibility on email, password, factor, activation, reset and remembered-account screens.
Preserve the full-width tenant banner and all existing login providers.

Run focused tests as each slice lands. Near completion, run unfiltered coverage for Identity,
server and dashboard, then the whole repository gate once:

```sh
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage
TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage
pnpm --filter @waitron/dashboard test:coverage
pnpm lint && pnpm typecheck && pnpm format:check && TESTCONTAINERS_RYUK_DISABLED=true pnpm test
```

Before heavy runs, check `memory_pressure` and the heaviest processes and coordinate with other
browser runs. Run Chromium from the host, outside Codex's macOS sandbox. Use the managed dev stack
(`wa-wt demo waitron-login-screen`) for manual password, invitation-mail and passkey smoke checks;
do not reset the shared database as a convenience. Record what actually ran. Mocked WebAuthn
tests do not establish that native browser autofill or device prompts work; document any native
device checks left to the owner.

Update `docs/developers/design-system.md` and the dashboard login convention in `CLAUDE.md` when
the implementation changes their current always-passkey/intermediate-menu rules. Keep the
no-enrolment-lookup invariant while documenting the local remembered-method exception. Sweep
`README.md`, `.github/instructions/`, `docs/ui-review.md`, and other consumers for stale claims;

add dated pointers to historical specs instead of rewriting history. Update the backlog when this
work's state changes. Commit with sign-off and hooks enabled. Announce readiness for `finish-branch`
after implementation and validation; finishing and landing remain separate owner actions.

## Validation recorded 2026-09-10

- `pnpm --filter @waitron/dashboard test:coverage` passed.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage` passed,
  including real-PostgreSQL action-issuance races. Deleting either person-row lock made its
  concurrency control fail with two successful operations.
- `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, and
  `TESTCONTAINERS_RYUK_DISABLED=true pnpm test` passed for the complete workspace after the final
  rebase onto `origin/main`.

The browser profile test checks that authenticator setup produces a QR image. Identity tests reject
an incorrect current code, store no factor before confirmation, and store the encrypted secret only
after a valid current code. These automated checks do not prove that a particular phone can scan the
rendered image or that its native passkey prompt behaves correctly; those remain device checks.

## Source receipts and limits

Code locations below were read during planning; no runtime verification is claimed:

- `packages/identity/src/manager-login.ts`: password verification precedes TOTP/recovery checks;
  `completeManagerLogin` returns a distinct suspended error before password verification.
- `packages/identity/src/account-action.ts`: invitation completion creates a session; reset
  completion returns none; current code validation is combined with credential completion.
- `apps/server/src/management-api.ts`: generated links use `/manage/account`, and only POST
  completion consumes an action; password-reset responses use the generic delivery path.
- `apps/dashboard/src/dashboard-app.ts`: account links precede session probing; login success
  probes the authenticated account; logout and expiry share the return-to-login path.

External guidance consulted on 2026-09-10. These sources inform the design, not claims that the
current implementation satisfies it:

| Source | Source's words | Application here |
| --- | --- | --- |
| [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#authentication-and-error-messages) | “respond (both HTTP and HTML) in a generic manner” | Do not reveal account existence or suspension through public outcomes. |
| [OWASP password recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) | “Single use and expire after an appropriate period”; “Don't automatically log the user in” | Bound action lifetime and preserve normal login after password reset. Initial invitation setup is a separate product decision. |
| [W3C WebAuthn](https://www.w3.org/TR/webauthn-3/#sctn-credential-id-privacy) | “Use client-side discoverable credentials” | Let the browser select a passkey without a public per-email enrolment lookup. |
| [Google passkey autofill](https://web.dev/articles/passkey-form-autofill) | “suggesting stored passkeys alongside saved passwords” | Offer passkeys directly from the email field where supported. |
