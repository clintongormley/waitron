# User management and account setup

Implementation plan for the `user-management` branch, agreed in the owner walkthrough on
2026-09-09 and written before implementation. It extends the
[first login/profile slice](2026-09-09-dashboard-profile-and-login.md).

## The experience you are building

You invite someone with their first name(s), last name(s), email and role. Telephone is optional.
Their display name defaults to their first name(s), and you can edit it. Use Display name for
till login and other quick staff identification, with first and last names in administrative
records. Do not introduce a separate username.

Names may duplicate. Display names must be unique within a tenant among active and pending human
accounts, ignoring case and surrounding spaces. Enforce the rule in the database as well as the
forms. Suggest a surname or nickname when there is a collision; do not silently append a number.
Recheck uniqueness when reactivating an inactive account. Email uniqueness continues to include
inactive accounts, so an invitation can reuse the original person and their history.

The admin table has Display name; Last name, first name; Role; Email; Phone; Status; and an
accessible pencil action. Build it on a reusable Lit data-table component intended for users,
devices, printers, canvases and other dashboard lists. The shared component owns table semantics,
responsive overflow, sortable column headings, empty/loading/error presentation, keyboard focus
and row-action placement. Consumers provide typed column definitions, rows and rendered cells.
Search and filter controls remain consumer-owned and feed already-filtered rows to the table, so a
generic component never learns user roles, device states or other domain rules. Search matches all
user names, email and phone as you type. Combine it with role and status filters. Show active and
pending by default, with Inactive and All available.
Use one wider, responsive edit modal with one Save/Cancel form for display name, first names,
last names, role, status, email and telephone. Keep Reset login, Reset PIN and Mark inactive
as distinct actions with clear consequences.

| Account state | What you can do |
| --- | --- |
| Pending | Verify the invitation and finish setup; no normal dashboard or device session |
| Active | Sign in and use the permissions assigned to your role |
| Inactive | No login; retain the person and all historical references |

Editing an inactive person's details leaves them inactive. Reactivate and send invitation is an
explicit action that moves them to Pending. Adding an email that belongs to an inactive person
offers View user or Reactivate and send invitation, never a duplicate record. Matching names alone
do not identify the same person. Selecting a status in the edit form follows these transitions;
it cannot turn Pending or Inactive directly into Active.

Reset login revokes sessions and credentials, invalidates old invitations and recovery actions,
moves the account to Pending and sends a new invitation. Include password, PIN, passkeys, Google
link, authenticator and recovery codes in the reset. Resend invitation rotates the invitation
without performing another credential reset. Reset PIN invalidates the PIN and requires a new
one through verified account access; the admin never supplies or sees it. Mark inactive revokes
sessions and outstanding account actions. You cannot mark your own account inactive.

An invitation contains a link and an alternative code. Verify either through an explicit submission,
not an email-scanner GET. Both lead to the same restricted setup session. Choose a password, set a
PIN when device access requires it, then offer a passkey with Set up later. Required setup completion
activates the account, rotates into a normal session and opens Your profile for checking details.
Do not require a second login just to trigger password saving. Test the new-password form with a
password manager. Interrupted setup resumes; skipping the optional passkey does not block it.

For a local-only installation, the email explains how to enter the code in Waitron at the restaurant.
Do not require a public dashboard hostname. Keep invitation sending outside the DB transaction;
delivery failure leaves a recoverable Pending account and an honest delivery status.

Your profile is available to every signed-in role. It supports names, display name, email, optional
telephone, language, PIN and password changes, passkey management, Google linking, authenticator
setup and one-time recovery-code download. Keep role and account status read-only here. Verify a
replacement email before making it the login address; retain the old verified address until then.
Telephone is contact information marked Unverified until the cloud SMS integration exists.

When your dashboard session expires, immediately clear the protected screen and return to login
with a Session expired message. Do not wait for another click or API call. Clear any in-progress
credential fields. When a sleeping tab resumes, check expiry before showing protected content.

## Boundaries and implementation defaults

- Keep Turnstile and SMS verification in the optional remote/cloud offering, as requested.
  Keep remaining built-in dashboard permission filtering in its existing backlog item.
- Device-login permission is a requested later follow-up. Current `loginWithPin` accepts every
  current role (`packages/identity/src/login.ts`). Require a PIN for those roles in this slice;
  centralize that policy so the later permission controls both onboarding and device login.
  Do not invent a new restriction based on job title.
- Treat the existing `admin` role as the owner role for the last-active-owner safeguard; there is
  no separate owner value in `packages/identity/src/schema/persons.ts`.
- Preserve passkey-first public login without revealing account enrolment. Password and recovery
  remain below Try another way; do not choose a public next step from account lookup results.
- Keep password recovery separate from onboarding: email recovery must not silently bypass an
  enrolled authenticator. Define lost-second-factor recovery through a recovery code or an explicit
  admin Reset login. This is a security default for implementation, not existing behavior.
- Google is optional per deployment and never the only usable local login method. Implement the
  integration and configuration path; live activation needs an OAuth client and registered callback.
  Resolve the supported callback for local installations before selecting a deployment topology.
- Authenticator and recovery codes are additional verification. Do not introduce a separate
  recovery-code-only login. A passkey may satisfy the strong reauthentication requirement without
  forcing a password-only user experience.
- Suggested additions not yet individually approved: a You badge, preserving table position,
  unsaved-change warnings, a user-visible session list and an admin change-history view. Keep these
  separate from required acceptance. Basic invitation delivery/expiry feedback belongs to the flow.

## Implementation order and acceptance

Use failing behavioral tests first for each feature or bug. Run the smallest meaningful suite while
editing, then the affected package unfiltered. Use real PostgreSQL for privileges and concurrent
transitions. Keep fiscal records untouched. Every read and write is scoped to the deployment tenant;
authenticated self-service derives person identity from the session, never a body field.

### 1. Trace the current account model and extend Identity

Start with `packages/identity/src/schema/persons.ts`, `staff.ts`, `profile.ts`, `permissions.ts`,
`account-action.ts`, `manager-login.ts`, `management-session.ts`, `credential.ts` and `passkey.ts`.
Trace all consumers of status, PIN presence, TOTP and display name across the entire repository,
including till rosters, provisioning seeds, sync classification, tests and documentation.

Add first names, last names, telephone and pending email verification state. Add Pending to the
account lifecycle; the existing `suspended` value can retain its internal spelling with Inactive
as the visible label. Represent an unset/reset PIN explicitly, never with a usable default PIN.
Update schemas, checks, grants, fixtures and generated migrations together. New identity tables
belong to Identity's migration set and classification. No production backfill or compatibility path.

Acceptance: duplicate legal names succeed; duplicate active/pending display names fail even under
concurrent creation; inactive duplicates are allowed but conflicting reactivation fails; email
remains reserved; Pending and Inactive fail every normal login path. Existing internal principals
and provisioning fixtures remain intentional, rather than acquiring fake contact details.

### 2. Make administrative changes atomic

Replace the series of independent edit operations with a tenant-scoped account update operation,
called from `apps/server/src/management-api.ts`. Add explicit reset, deactivate, reactivate and resend
operations with server permission checks. Keep details editing independent of lifecycle actions.
Serialize owner-count checks and role/status changes using a common per-tenant lock so concurrent
admins cannot remove the last active admin. Define one lock order shared by every affected operation.

Acceptance: self-deactivation fails, including uppercase UUIDs; another permitted admin can
deactivate a colleague; the last active admin cannot be demoted, reset into Pending or deactivated;
concurrent requests preserve that invariant. A rejected transition rolls back all accompanying
edits. Revoked sessions and old account links remain unusable after later reactivation.

### 3. Build invitation verification and resumable setup

Extend `account-action.ts` and `schema/management-account-actions.ts`, the account-action routes,
email templates and the account-action mode currently rendered by `login-screen.ts`.
Keep random link tokens hashed. Give manual codes their own short expiry and attempt budget;
use a server-keyed digest for low-entropy codes, never a plain enumerable hash. Bind each code
to the invitation and email. Atomically consume either proof and invalidate its sibling.
Use a restricted setup session, with expiry, that can only complete that account's setup.
Default to the existing 24-hour invitation-link lifetime and a 10-minute code lifetime; resending
issues fresh proofs and invalidates predecessors. Enforce the 60-second resend delay server-side.

Acceptance: link/code replay, wrong tenant, expired proofs, guessing, simultaneous link/code
submission and stale invitations fail; a valid proof cannot alter role or another account. Pending
accounts cannot reach ordinary APIs. Email-verified setup survives a page reload without returning
to the start. Completion cannot activate an account an admin has since deactivated or reset again.
Email failure is recoverable; no tokens, passwords, PINs or codes appear in logs or plain retry queues.

### 4. Replace the admin list and edit flow

Add the shared table under `packages/ui/src/components/` with focused semantic, interaction,
responsive and accessibility tests; export it through the UI package's existing component surface.
Update `apps/dashboard/src/widgets/staff-list.ts`, `person-form.ts`, `person-edit.ts`,
`screens/staff-screen.ts`, `api/client.ts` and their tests. Use the shared form contract, localized
English/Spanish labels, field errors and a form summary. Name columns must handle multiple names.
Keep the table usable on smaller screens without squeezing form inputs. The existing wider modal
and disabled self-deactivation control are a starting point, not the complete redesign.

Acceptance: search updates without submitting; combined filters and inactive views work; the pencil
has an accessible person-specific label; one Save persists the complete form; Cancel discards edits;
inactive detail changes preserve status; duplicate inactive email offers the existing record.
Lifecycle actions have clear confirmation copy and cannot run twice from a double click.
The shared table renders domain-neutral column and row definitions, preserves native table semantics,
supports keyboard use and narrow viewports, and contains no user-management vocabulary. Do not migrate
devices, printers or canvases in this slice unless using the component exposes a small compatible
cleanup; their migration is separate from proving the reusable contract with the users page.

### 5. Extend profile and verified credential changes

Build on `packages/identity/src/profile.ts`, `apps/server/src/me-api.ts` and
`apps/dashboard/src/screens/profile-screen.ts`. Add names, phone, display-name collision handling,
PIN changes and pending email confirmation. Introduce a short-lived, action-bound reauthentication
proof that can use an existing password plus enrolled second factor, or an existing passkey.
Do not accept a normal session alone as permission to replace login methods.

Acceptance: all roles can edit their own details only; email stays unchanged until verification;
old proofs fail after relevant account changes; changing a PIN revokes applicable device sessions;
reset-PIN users cannot enter a till until they choose a new PIN. Personal details remain editable
without unnecessary password prompts. Credential forms clear secrets on Cancel and completion.

### 6. Add authenticator enrolment and recovery codes

Implement encryption at rest before writing TOTP secrets. Follow `@waitron/credentials`' vault
pattern without introducing a module dependency cycle; pass the crypto capability through the
server composition boundary. Preserve offline verification and define key rotation/restore behavior.
Stage a new authenticator secret until a valid code confirms enrolment. Name passkeys and allow
their removal through reauthentication while keeping a usable login method.

Generate cryptographically random recovery codes, store only their digests and consume one
atomically. Offer a one-time download/print view, remaining count and regeneration that invalidates
the old set. Do not retain downloadable plaintext. Reject reuse of accepted authenticator time steps
where they authorize a sensitive action. Replacing/disabling MFA revokes its old recovery material.

Acceptance: wrong/expired setup codes do not enable MFA; stored secrets are encrypted; no secrets
leak in list APIs or logs; concurrent recovery-code use succeeds once; regenerated codes replace
all old codes; passkey users can manage credentials without being forced to invent a password first.

### 7. Add optional Google account linking

Use Google OpenID Connect with server-validated issuer, audience, expiry, state and nonce, and
an authorization-code flow with PKCE. Bind links to Google's stable subject ID, not matching email.
Link only after verified access to the existing Waitron account; never auto-merge accounts by email.
Store provider credentials through the existing vault boundary. Show setup only when configured,
with a clear explanation when Google is unavailable and an immediate local-login alternative.

Acceptance: callback forgery, wrong account, duplicate provider identity, link/unlink races and
deactivated accounts fail. Google cannot bypass required MFA or Pending setup. Local password,
passkey and PIN operation remain available when Google or the internet is unavailable.

### 8. Return to login automatically at session expiry

Trace `management-session.ts`, the session/me response, the dashboard API client and
`dashboard-app.ts`. Expose the server's authoritative expiry time and keep the browser deadline
aligned with successful session activity. Schedule logout at that deadline, cancel/reschedule the
timer on login/logout/renewal, and recheck on visibility/focus changes. Coordinate same-origin tabs
without letting a delayed response restore a logged-out session. Confirm whether background polling
currently renews the server idle timeout; do not silently change its meaning in the browser alone.

Clear authenticated screen state and credentials before rendering login. Centralize expired,
revoked and inactive-session handling across API calls. A known expiry is handled by the timer;
server-side revocation is handled when received, rather than claiming a timer can discover a remote
admin action. If immediate cross-device revocation display is required, plan a server notification
path separately; server access checks must reject revoked sessions immediately either way.

Acceptance: an idle visible page returns to login at expiry without interaction; renewed activity
moves the deadline; a resumed expired tab shows login; late responses cannot repaint protected
content; repeated expiry signals produce one transition; another tab's renewal is reconciled with
the server. Use fake-clock behavioral tests and a real browser focus/visibility check.

### 9. Privacy information and final verification

Provide a tenant-specific privacy-notice link in the invitation, setup and profile. Explain the
controller/contact, purposes, legal bases, recipients, retention and rights. Do not add mandatory
blanket GDPR consent. Keep actual restaurant policy wording and retention decisions on the legal
track; software completion is not a claim of GDPR compliance. No automatic deletion of staff
history or fiscal records. SMS verification and remote Turnstile stay deferred.

Run the complete repository gate once near completion:
`pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
Then run affected-package coverage; include identity dependents touched by the schema/status changes.
Check memory and other test processes before host Chromium/Postgres runs; set
`TESTCONTAINERS_RYUK_DISABLED=true`. Exercise real concurrent owner, display-name, invitation and
recovery-code tests. Inspect narrow and wide layouts and try browser password saving manually.
Update the backlog, design-system guidance and all prose about retired lifecycle behavior.
Commit with sign-off, never bypass hooks. Announce readiness for `finish-branch`; do not merge.

## Sources and deployment decisions

These are design inputs, checked 2026-09-09; confirm provider details again during implementation.

| Source | Source wording and application |
| --- | --- |
| [European Commission: obligations](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations_en) | “Regardless whether the personal data has been collected directly from the individual or been obtained from another source”: provide privacy information when an admin invites someone. |
| [European Commission: legal grounds](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/legal-grounds-processing-data_en) | “Consent is not freely given if ... there is a clear imbalance”: do not make blanket employee consent the basis for required account processing. Confirm the actual legal basis with the restaurant's adviser. |
| [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) | Use the provider's stable `sub` identifier for linking; verify the documented callback and token requirements before implementation. |

The concrete Google OAuth client/callback and the restaurant's privacy notice are deployment inputs,
not permission to leave the integration or notice surface unbuilt. Complete testable implementation
and report any live configuration still missing. Do not enable SMS verification without the later
cloud SMS service, or pretend an unverified contact number proves account ownership.
