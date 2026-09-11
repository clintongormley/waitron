# Login-flow implementation plan

Follow [the design](../specs/2026-09-11-login-flow-refinements-design.md), using the stated defaults: no unchecked storage, and explicit actions for device dialogs.

1. Reproduce storage and navigation complaints in dashboard tests. Make Remember control persistence; make account switching clear every stored shortcut. Keep authenticated identity as the only source for writes.
2. Reproduce the heading, repeated checkbox, automatic modal and hidden-method behavior. Simplify the login renderer around permanent headings, labeled email context, a change-account icon and always-visible links. Preserve password-manager fields, error summaries, focus, factors, cancellation and stale-response guards.
3. Add failing account-action UI tests, then show the language chooser and validated email. Retain separate invitation and reset authorization. Implement the optional passkey offer after authenticated password setup/reset sign-in, with skip and error handling.
4. Add failing named-passkey persistence/API/profile tests. Add Identity's optional name column and generate its migration with drizzle-kit; carry the name through registration and profile display. Keep registration verification real in browser tests by stubbing navigator.credentials.
5. Add failing email-zone tests and a deployment-location read test. Resolve the stored venue time zone and pass it to all account email senders; test daylight-saving behavior and both link/code expiries.
6. Update current conventions, historical pointers and backlog. Run the complete gate once after implementation and relevant package coverage. Rebase only if needed for conflicts or overlapping new main code, then obtain one fresh isolated review of the expanded branch. Triage, fix, push through hooks, update PR #317's title/body and verify green CI on its final SHA. Do not merge.
