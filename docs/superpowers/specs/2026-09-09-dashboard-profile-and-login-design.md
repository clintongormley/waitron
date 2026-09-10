# Dashboard profile and login

You can cancel sign-in from any step and return to a blank email form. The form is at most 30rem
wide. Alternative sign-in methods appear below the main action row. Password recovery has its own
confirmation screen showing the address, delivery guidance, and a 60-second resend countdown.
The server suppresses repeat recovery emails for one minute per normalized address, returning the
same 202 response for known and unknown accounts. This cooldown is per process, as is PIN backoff.

Password login uses the existing PIN delay policy: three incorrect attempts without a wait, then
2, 4, 8, 16, 32 and 60 seconds. Success clears the streak; 15 minutes of inactivity expires it.
The public-email adapter bounds its memory and prevents overlapping attempts for one address.
Unknown addresses receive the same policy. Turnstile is deferred to optional remote access in the backlog.

Your profile is available in the authenticated banner for every role, including staff. It lets you
edit your display name, email and language, change your password, and add or remove your passkeys.
Existing passkey registration remains bound to the signed-in person. Roles, suspension and other
people's records are outside this surface.

The server derives your identity from the session and checks the deployment tenant explicitly.
Changing email or password and removing a passkey require your current password, plus your TOTP
code if enrolled. Accounts without a password use password recovery to establish one first.
An email change keeps the verified login address in place, records the replacement as pending, and
invalidates outstanding invitation/reset links. A short-lived code sent to the replacement address
makes it the login only after the signed-in person enters that code in their profile.
A password change invalidates outstanding links and other dashboard sessions, preserving the
current session. Passkey removal must not remove the only remaining login method.

Identity adds pending-email and email-action fields to its existing tables. Identity owns the profile operations; the server
exposes session-scoped endpoints; the dashboard owns the forms and browser passkey ceremony.
Permission filtering for the remaining built-in navigation is a separate backlog item.

Validation covers wrong and cross-tenant sessions, attempts to alter another person, incorrect
current credentials, reset-link/session invalidation, passkey ownership, and browser form behavior.
Real PostgreSQL exercises the writes as `app_user`; browser tests exercise all-role profile access.

In the admin user editor, you cannot mark your own account inactive. The control is disabled for
your account and the identity operation independently rejects the change. A rejected combined edit
rolls back its other changes. The editor uses a wider layout that stays within the viewport.
