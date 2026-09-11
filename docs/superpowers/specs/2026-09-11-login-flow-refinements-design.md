# Clearer dashboard sign-in and account setup

You should see the same sign-in choices regardless of how you reach the page. Entering an unfamiliar email must not unexpectedly open a device dialog, and choosing another account must actually forget the saved shortcut.

This extends `login-flow` / PR #317. The earlier browser-language change remains part of the branch. The owner's 2026-09-11 instructions supersede the automatic first-email passkey and unchecked tab-memory behavior in the 2026-09-10 login plan.

## Sign-in behavior

- The email page always has the heading “Please log in to continue”, an Email field, one “Remember my email” checkbox, and Continue. Do not repeat the checkbox on later steps.
- Remember saves the authenticated email and last successful method only when selected. When unchecked, save nothing: current-form state survives stepping between methods, but refresh/logout does not restore the identity. Keep the opted-in shortcut in localStorage, not a cookie. Remove the unchecked sessionStorage shortcut. Google navigation carries a single-use opt-in intent in sessionStorage for up to ten minutes; consume it only on the successful callback, and save the shortcut only after getMe confirms the account. A saved account’s consent never transfers to another account.
- “Use another account”, and its replacement icon beside the displayed email, clear saved email and method as well as the current attempt. Refresh must stay on blank email entry. Forgetting must not depend on the displayed email matching an older saved identity.
- With no saved method, Continue opens the password form. Offer passive browser passkey autofill, but no automatic modal. A remembered method selects its corresponding screen. A passkey dialog starts only after an explicit Continue/passkey action, never merely on navigation, refresh, logout, or expiry. Do not query server account/passkey status to choose the public screen.
- Method screens use “Login with password” or “Login with passkey”. Show Email as a label and the address as text, with an accessible change-account icon at the right. Retain the hidden semantic username input for password managers. Remove the separate Forget and Cancel buttons from ordinary sign-in.
- Available alternative methods are always a bulleted list of links. Remove the intermediate “try other methods” screen. “I've forgotten my password” sits directly below the password field. Keep second-factor verification and its recovery-code alternative after password verification.
- Suppress the redundant `management_session.required` notice when the permanent heading already explains the page; retain specific expiry, suspension and reset-completion messages.

## Invitation and password setup

Use one recovery entry point: pending accounts receive a setup link, active accounts receive a reset link, and every address receives the same public acknowledgement. Remove manual invitation-code entry and invitation-code instructions from email. The server still chooses the appropriate action internally and preserves its authorization, account-status rules and token lifetime. Do not expose the selected purpose in the public request response.

Language changes repaint the existing login component so the current email, password step and passkey offer remain in progress. Authenticated screens retain their existing locale-based remount behavior.

Both activation and reset pages show the language chooser and, once the server validates the action, the authoritative email under an Email label. A URL fragment is a password-manager hint, not authoritative display identity before validation.

After initial password setup creates an authenticated session, offer optional passkey creation with a name and a Skip action. After password reset, first complete normal sign-in, including any existing second factor, then offer passkey creation. A reset does not automatically log in or remove a factor. Clear temporary passwords when leaving the attempt; never put credentials in browser preference storage.

## Named passkeys

Add an optional, trimmed display name (maximum 80 characters) to the identity module's credential record, registration API and profile response. Collect it during registration and display it in the existing passkey list; unnamed keys retain a numbered fallback. Authentication still identifies a credential by its verified credential ID. Names neither select nor authorize an account. The migration belongs to Identity, not core. Keep session/tenant/person scoping and registration reauthentication.

## Email expiry times

Use the deployment location's stored `timeZone`, which onboarding derives from country and administrative area. Format link and short-code expiry with that IANA zone, including its zone label and the recipient's existing UI locale. Share the configuration for invitation, reset and email-change messages. Do not infer a time zone from language or the host clock. Accounts can span locations; this decision uses the location served by this deployment.

## Validation

Use failing behavioral tests before each change. Cover storage opt-in and forgetting across refresh, first-email behavior, remembered methods, no unsolicited modal after logout, stable headings and alternative links, recovery placement, account identity/language display, optional passkey creation and skip, named credential persistence and tenant scoping, and venue-zone expiry across a daylight-saving boundary. Keep existing account-status, token-use, session-expiry, second-factor, password-manager and WebAuthn assertions.

Run focused checks while implementing, then the full repository gate and required coverage. Review the expanded branch once in a new isolated Claude checkout before finishing: the earlier 185-second review covered only browser-language selection, not this expanded scope.

## Source receipts

Initial code observations, before these changes: `login-preference.ts` writes sessionStorage even when unchecked; `login-screen.ts` always opens a passkey ceremony after Continue and hides the language chooser in account-action forms; `account-action.ts` limits reset to active and invitation to pending accounts; `account-email.ts` explicitly formats UTC; `profile.ts` returns numbered credentials without a name. These are code-reading observations, not runtime verification.

External sources consulted 2026-09-11:

| Source | Source's words | Decision |
| --- | --- | --- |
| [MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) | “survives over page reloads and restores” | Browser tab storage is not tied to Waitron logout. Use only explicitly opted-in persistence. |
| [MDN cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies) | “Cookies are sent with every request” | A browser-only display preference does not need a cookie. |
| [Google passkey management](https://web.dev/articles/passkey-management) | “Display the passkey name” | Give each stored credential a recognizable display name. |
