# Dashboard account activation and recovery — implementation plan

Spec: `docs/superpowers/specs/2026-09-08-dashboard-account-activation-design.md`.

1. Make email required at every human account creation/provisioning boundary. The database column
   remains nullable for internal principals and low-level fixtures. Add failing identity, server and
   dashboard tests before implementation; regenerate identity migrations rather than editing snapshots.
2. Add identity-owned account-action state and token lifecycle. Test issuance, replacement,
   expiry, single-use completion, password reset and session revocation against PGlite, then run the
   real-Postgres grants/trigger suites.
3. Add the provider-neutral email message/sender contract and SMTP adapter. Test message rendering
   and error handling without a live network.
4. Add Mailpit to the shared development Compose stack and document its SMTP/UI endpoints. Pin the
   image version and add a root guard test for the service contract.
5. Add public reset-request and action-completion routes plus automatic invitation creation on the
   gated person-create route. Inject delivery so API tests remain hermetic; keep public responses
   enumeration-neutral.
6. Wire production SMTP through the encrypted credential vault and development through Mailpit.
   Deliver after the action transaction commits, report invitation failure, and keep bearer tokens
   out of persistent mail queues.
7. Change the dashboard to email-first progressive login, remove the up-front TOTP field, add forgot
   password and action-completion screens, and require email in Users creation. Apply the shared form
   contract for semantic names, required/error feedback, action placement and contextual help. Cover
   behavior and both themes with browser accessibility tests.
8. Sweep old nullable-email/up-front-TOTP claims and update current README/backlog documentation.
   Run focused checks during implementation, then the whole repository gate once.
