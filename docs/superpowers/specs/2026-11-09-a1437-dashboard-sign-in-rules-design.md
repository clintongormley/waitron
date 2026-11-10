# A1437: the dashboard's sign-in follows Cloud's rules, with SMS codes through Cloud

**Design only, nothing built. The owner answered every choice on 2026-11-09 (§7); the first build step is in lane K's queue.** The rules come from the owner's
decision of 2026-11-08 (11:25, made with the campaign watcher; the watcher's file
`sign-in-rules-20261108.md`), shared with Waitron Cloud's account design (Cloud repository, D608,
`docs/superpowers/specs/2026-11-07-cloud-single-owner-lifecycle-design.md`) and its SMS design (D610,
`docs/superpowers/specs/2026-11-07-cloud-venue-sms-gateway-design.md`). This page applies them to the
dashboard (the back-office website on the box). The till's PIN sign-in does not change.

Words used here: a **proof** is something that shows it is really you besides your password: a
passkey, an authenticator app's six-digit code, a code sent by email or text message, or one of your
saved recovery codes. **Asked again** means the dashboard asks for a proof a second time, while you
are already signed in, before a risky action.

## 1. Signing in: what changes for staff

| The account has | Today | With this design |
| --- | --- | --- |
| A passkey | The passkey signs you in alone (`packages/identity/src/passkey.ts:332`) | Unchanged |
| An authenticator app | Password, then the app code (`packages/identity/src/manager-login.ts:129-151`) | Unchanged |
| A passkey, but you type the password instead | The password alone | Password, then the app code if there is one; otherwise a code by email, or by text message if you choose "text me instead" |
| Password only | The password alone, on any browser | The password alone on a browser this account has used before. A **new browser** also gets a code by email (or text, if chosen) and is then remembered |
| Google | Google alone; refused when an app is set up (`google-oidc.ts:151`) | Through Cloud only, for a Cloud-connected venue (choice 7a) |

New: an **administrator setting, off by default**: "everyone who signs in must set up an
authenticator app or a passkey".

A password reset by email link resets the password only; an account's app and passkeys are kept, so
the next sign-in still asks for them. Reset already works this way: it sets the password and ends open sessions, nothing else (`packages/identity/src/account-action.ts:322-338`).

The sign-in page still never says whether an email has an account or a passkey (CLAUDE.md §3,
"A login refusal never reveals account existence"). The new email-code step must keep that: it is
shown, and costs the same time, for an address with no account.

**Remembering a browser is new.** Today nothing is remembered on the server: "Remember me" keeps only
the email and the sign-in method in the browser (`apps/dashboard/src/login-preference.ts:61-82`), and
the sign-in cookie ends with the browser session (`packages/server-kit/src/management-cookie.ts:11-18`).
The design adds a long-lived browser cookie holding a random token, stored on the box only as a hash
(CLAUDE.md §3, "Store anything that works as a live login as a hash"). How long a browser stays
remembered: 30 days from its last sign-in (choice 7b).

**Implementation update, 2026-11-10:** the shared window now covers your own sign-in changes,
including passwordless accounts. An enrolled authenticator still needs its own code for each
change; recovery codes cannot replace it. The account behavior below describes the original design baseline.

## 2. Asked again: what exists today

One check already exists: `confirmFreshSignIn` (`apps/server/src/fresh-sign-in.ts:45`) asks for your
password or one of your passkeys, plus your app code (or a recovery code) when you have one. Only two
actions use it: making a recovery pack (`backup-recovery-pack-api.ts:386`) and starting a handover
(`handover-source-start-api.ts:471`). The dashboard has a window for it
(`apps/dashboard/src/widgets/fresh-sign-in.ts`).

Your own sign-in changes (password, PIN, email, passkeys, app, recovery codes, Google) ask for your
current password plus your app code (`packages/identity/src/profile.ts:122-130`). A person with no
password (signed up by passkey or Google) is refused all of them (`profile.ts:92`): they cannot change
their own sign-in at all. This design fixes that, because the check becomes "the proof you signed in
with".

Every other risky action is guarded only by the sign-in cookie and the person's role.

## 3. The actions that ask again

Under the new rule the proof asked for is the one you signed in with: your passkey, your app code, or
for a password-only account a code by email (text if chosen). The list, from the code, with why each
is on it:

1. **Backups and the box's keys.** Making a recovery pack (already asks); downloading the box's
   recovery file (`POST /api/box/recovery-pack`) or its encrypted secrets bundle
   (`POST /api/box/recovery-bundle`); showing the backup recovery key, which the route returns in
   plain text (`GET /api/backup/recovery-key`, `backup-api.ts:512`); changing where backups go or
   turning them off (`backup-api.ts` apply, disable, rotate; `stream-api.ts`); retiring the box
   (`POST /api/box/retire`). Why: each one either hands out everything needed to read the venue's
   data, or sends it somewhere else.
2. **Exports.** The configuration export (`configuration-export-api.ts:36`) and another person's
   personal data (`personal-data-export-api.ts:129`). Why: a copy of the business or of someone's
   data leaves the box.
3. **People and roles.** Inviting someone, changing a role, suspending, deactivating or reactivating
   someone, resetting someone's sign-in, changing someone else's email (`management-api.ts`
   staff routes; checks in `packages/identity/src/staff.ts`). Why: these decide who can sign in and
   with what power. Not on the list: editing names, and clearing a staff PIN (a till-only sign-in,
   done often on a busy floor).
4. **Payments.** Connecting or disconnecting a card-payment provider, which stores its credentials
   (`payments-api.ts:729`, `:762`). Not card readers: adding and renaming readers is routine.
5. **Fiscal.** Installing the tax certificate (`fiscal-certificate-api.ts:69`), changing the
   business's legal name (`venue-settings-api.ts:257`), and the fiscal remedies
   (`packages/fiscal-verifactu/src/record-remedy-routes.ts:48`). Why: they change what is filed with
   the tax agency in the business's name. The tax number and the Veri\*Factu settings have no change
   route after setup, so there is nothing to guard.
6. **Other boxes.** Handover (already asks); removing a box from the venue
   (`membership-removal-api.ts:66`, `:80`). Promotion and making a mirror already take a password and
   app code in the request (`operation-authentication.ts`); they move to the same check, so a passkey
   works there too. Pairing a till or print agent is not on the list (choice 7c).
7. **Cloud and email.** Connecting the venue to Waitron Cloud or ending the connection
   (`cloud-api.ts:180-181`), turning on remote access (`:152`), preparing a replacement box
   (`:116-117`), and changing the email (SMTP) settings (`email-settings-api.ts:78`, `:92`). Why: the
   email settings decide where sign-in codes go, so whoever changes them could read every code.
8. **Your own sign-in.** Password, email, passkeys, app, recovery codes, Google link. These already
   ask; they move to the same check.

Restoring a backup and Start again are not dashboard actions: they run on the box's setup and
recovery pages, before anyone can sign in, and keep their own checks.

## 4. SMS, through Cloud only

Waitron sends no text message itself; there is no SMS code in the repository today. It asks Cloud,
naming one of Cloud's fixed templates and its values, never free text (D610, "Requesting a code").
Cloud sends it and counts it; Waitron makes the code, checks the reply and records the tries.

Texts carry codes for two things only: confirming a phone number when a person adds it to their
profile (`persons.telephone` exists today, unconfirmed), and the second check when the person chooses
"text me instead". Never sign-in by text alone.

Cloud's limits apply (D610): one request a minute per number, 10 texts a venue a day, five wrong tries
per code, EU numbers only. Each text counts toward the venue's monthly figure on its Cloud plan
(Registered, free: 10 a month; Connected: 25; per venue, owner 2026-11-09; not enforced at first).

So SMS needs a venue connected to Cloud (the box's `cloud-connection.json`, `apps/server/src/cloud-client.ts:189`).
It also needs Cloud's D610 built; until then the "text me instead" choice is not shown.

## 5. A venue without Cloud

The owner, 2026-11-09 (choice 7d): "i think we should just require a cloud login for now, so they'll
automatically get email via cloud". So this design assumes a venue connected to Cloud: email codes,
text messages and Google all go through Cloud. A venue without Cloud is not a path in this design;
it is a short backlog entry, low priority ("shouldn't be forgotten").

## 6. What it costs to build

Rough sizes, tests included. About 3,000 lines over five pull requests:

1. **Ask again on the §3 list** (~900 lines): one check function in `packages/identity`, the
   remembered "proved at" time on the sign-in session (one new column on `management_sessions`, for
   choice 7e's time window), the check on about 25 server routes in `apps/server`, and the
   existing window (`widgets/fresh-sign-in.ts`) opened by each dashboard action. Uses only today's
   proofs (password for a password-only account) until step 2 lands. The biggest gain for the least
   work: build first.
2. **Email codes and remembered browsers** (~900): a table of sign-in codes (hashed, short expiry,
   five tries) and a table of remembered browsers, the sign-in steps on the login screen, and the
   email text in English and Spanish.
3. **The administrator setting** (~250): one setting, the check at sign-in, and the screen that sends
   a person to set up an app or passkey.
4. **SMS through Cloud** (~700): the signed request to Cloud (the same signing as `cloud-billing.ts`),
   phone confirmation on the profile, "text me instead". Waits for Cloud's D610 build.
5. **Guides** in English and Spanish for each step, inside each pull request.

Packages: `identity`, `db` (two tables, one column), `apps/server`, `apps/dashboard`. A1438 (code
shared with Cloud) would take the sign-in decision itself, so step 2 should agree with Cloud's
version before either is built.

## 7. The owner's choices (answered 2026-11-09)

- **7a. Google: through Cloud.** Cloud holds Waitron's Google sign-in client, and the box trusts
  Cloud's signed answer about who signed in. Only venues connected to Cloud get Google; the box's own
  Google settings (`WAITRON_GOOGLE_CLIENT_ID` and `_SECRET`) are not offered to venues.
- **7b. A remembered browser: 30 days** from that browser's last sign-in. Every remembered browser is
  forgotten when the password is changed or reset.
- **7c. Pairing a till or print agent: not asked again** (the recommendation). Pairing needs the
  device on the venue's own network with pairing mode on, and setting up a venue pairs many devices
  in a row.
- **7d. A box that cannot send email: require Cloud for now** (§5). Email codes are sent through
  Cloud.
- **7e. One proof covers 15 minutes**, or until the sign-in session ends if that is sooner: the
  owner, "until the session timesout or 15 minutes". It covers every §3 action in that session, so
  inviting three people asks once.
