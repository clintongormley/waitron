# Dashboard account activation and recovery — design

Status: approved for implementation (2026-09-08).

2026-09-09 owner update: the Dashboard flow below is superseded where it conflicts with the
passkey-first, enumeration-neutral flow recorded in `CLAUDE.md` and
`docs/developers/design-system.md`. Password and recovery now sit behind **Try another way**. The
public routes use bounded, process-local per-subject and global rate limits; this slice does not claim
a durable failed-verification counter across replacement tokens.

This design supersedes the nullable-email and up-front-TOTP decisions in
`2026-08-30-dashboard-sidebar-email-login-design.md`. That document remains historical.

## Outcome

Every person has one account with two deliberately separate entry paths:

- a required, unique email identifies them on the dashboard;
- their PIN remains the credential for an enrolled venue device;
- the dashboard accepts a password or passkey;
- TOTP, when enrolment exists, is requested only after a password has been accepted;
- an emailed invitation verifies the address and lets a new person choose their own password;
- an emailed reset link lets an existing person replace a forgotten password.

Routine passwordless email login and SMS are follow-ons. Email remains a recovery/activation
channel, not the only way to use an on-prem dashboard.

## Email delivery

The server depends on a small `EmailSender` interface. Development uses Mailpit over SMTP: the
shared Compose project publishes SMTP on `127.0.0.1:1025` and its inspection UI on
`127.0.0.1:8025`. Production reads a venue SMTP payload from the encrypted credential vault under
`email.smtp`. Production operators should use an `smtps://` URL or a relay that advertises STARTTLS.

Creating a person or requesting a reset commits the hashed action before attempting SMTP delivery.
A send failure never rolls back an account write after the fact: creation reports that the invitation
was not sent, and the user can retry through “Forgot password?” after SMTP is restored. An automated,
encrypted retry outbox is a later reliability improvement; storing a raw bearer token in a plain
outbox is not acceptable.

## Account actions

`management_account_actions` is identity state. Each row contains a person, a purpose
(`invitation` or `password_reset`), a SHA-256 token hash, and creation/expiry/use timestamps. The raw
256-bit token leaves the server in the emailed HTTPS link, but Waitron stores only its hash in the
database and does not put the token in its logs. Issuing a new action invalidates unused predecessors
of the same purpose.

The public completion endpoint accepts the raw token and a new password, validates purpose,
expiry, single use and password policy, changes the password, consumes the action, and ends the
person's other management sessions in one transaction. It then creates a fresh session for the
browser that completed the action.

A GET never consumes a token. The dashboard renders a confirmation/password form first and consumes
the token only on an explicit POST; mail security products inspect and rewrite links before the
recipient clicks them.

Reset requests always return the same accepted response, whether the address exists or not. Issuing
and completing actions are rate-limited at the public boundary. Account creation remains manager
gated.

## Dashboard flow

The login screen starts with email only. Continue advances to password entry and carries the email
forward; passkey stays available as an alternative because today's passkeys are discoverable and do
not require an email lookup. The form no longer shows TOTP before it is required. Until TOTP
enrolment is implemented, no production account can reach that step.

“Forgot password?” appears on the password step and requests a reset without revealing whether the
address exists. An invitation/reset URL opens the action form before the normal session probe.

The Users create form requires email. Its confirm control stays available so an incomplete attempt
can identify every missing or malformed field. A successful create sends the invitation
automatically and reports whether delivery succeeded.

Account forms use the shared form contract in `docs/developers/design-system.md`: semantic native
field names and autocomplete purposes, visible required markers, field-level explanations, one
generic error summary, and a final action row with the primary action on the right and Cancel or Back
on the left. Short optional explanations use the shared click-to-open help tooltip.

## On-prem routing

Links use the configured management origin. A remotely used dashboard therefore needs the stable
HTTPS tunnel hostname already required by the deployment; a LAN-only link is usable only from that
LAN. Email does not create inbound reachability. Password and passkey login remain usable when the
mail relay is offline.

## Security controls

- Links require HTTPS outside loopback development.
- Tokens are random, hashed at rest, purpose-bound, expiring and single-use.
- Token values never enter structured logs, URLs rendered into third-party resources, or error
  parameters; action pages set `Referrer-Policy: no-referrer` and load no third-party content.
- Reset initiation and token verification are throttled; a replacement token does not reset failed
  verification counts.
- Password reset ends existing dashboard sessions.
- Passkeys remain the preferred phishing-resistant method. SMS, when added, is an alternative
  recovery channel rather than a security upgrade over passkeys.

## Verification

Tests cover database constraints and grants, token lifecycle, enumeration-neutral reset requests,
transactional account creation plus invitation, SMTP formatting against an injected transport,
Mailpit configuration, and the progressive login/action UI.

External guidance consulted 2026-09-08:

- NIST permits HTTPS representations of issued recovery codes and distinguishes recovery/email
  confirmation from routine authentication:
  https://pages.nist.gov/800-63-4/sp800-63b/events/
- NIST does not treat manually transferred email/SMS codes as phishing-resistant and classifies PSTN
  authentication as restricted:
  https://pages.nist.gov/800-63-4/sp800-63b/authenticators/
- Microsoft documents link scanning, rewriting and detonation:
  https://learn.microsoft.com/en-us/defender-office-365/safe-links-about
