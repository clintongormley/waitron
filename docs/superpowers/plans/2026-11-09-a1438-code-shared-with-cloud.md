# A1438: code Waitron and Cloud should share, published like ui-core

**Plan only, nothing built. Waiting for the owner's choices (§6).** The owner asked on 2026-11-08
whether the sign-in code copied from Waitron into Cloud should be shared instead, and how: "let's not
publish it like verifactu. instead treat it like waitron-ui". Waitron Cloud is the separate,
closed-source service at `~/workspace/repos/waitron-cloud`; paths below starting `cloud:` are in it.

## 1. Where things stand

- **Nothing is shared yet except the screen components.** Cloud copied Waitron's sign-in code by hand
  from an old Waitron commit and adapted it (cloud: `packages/identity/SOURCE.md:3-12`, which says
  "No automatic synchronisation or shared identity package has been established"). The two copies
  have since drifted (§3).
- **How ui-core is shared today.** A push to `main` that changes `packages/ui-core` runs
  `.github/workflows/publish-ui.yml`: it checks, packs and test-installs the package, then publishes
  it to GitHub's private package registry as `@waitron-io/ui-core`, version `0.2.<run number>`.
  Cloud pins an exact version (cloud: `apps/portal/package.json:12`), Dependabot proposes a newer one
  daily, and Cloud's CI fails when it falls more than 7 days behind.
- **The one hard limit.** The release script refuses a package with any runtime dependency
  (`scripts/release/prepare-ui.mjs:65-81`); only Lit is allowed, as a "peer" (a library the
  installing project supplies itself). So a shared package cannot lean on Waitron's other packages:
  Waitron's `packages/identity` depends on six of them, including its database, which is why it
  cannot simply be published as it is.

## 2. The proposal

One new package in the Waitron repository, `@waitron/contract` (published as `@waitron-io/contract`):
the rules both sides must apply identically. It holds no database code, no storage and no network
calls, only checks, settings, formats and texts. Its outside libraries (`otplib`,
`@simplewebauthn/server`) are peers, so each repository supplies them and the release script's rule
stays. Waitron never depends on Cloud's code.

**Not shared:** roles and permissions (D608 keeps Cloud's one-owner model apart from venue staff on
purpose), storage, sessions, routes and screens, how each side encrypts a stored authenticator secret
(each binds it to its own storage), and the sign-in throttles.

## 3. What moves, in three parts

### 3a. Signing between the box and Cloud (first; ~250 lines)

The box signs its requests to Cloud; Cloud checks them. Both sides hold their own copy of the same
three formats: pairing (`waitron-cloud-pair-v1`: `apps/server/src/cloud-client.ts:277-292` against
cloud: `packages/registration/src/pairing-proof.ts`), machine requests (`waitron-cloud-machine-v1`:
`apps/server/src/cloud-installation.ts:235-252` against cloud: `installation-proof.ts:34-50`) and
the access lease Cloud issues and the box checks (`waitron-cloud-access-v1`). The field lists match
today. Three test files are byte-identical in the two repositories and pin them.

- **Moves:** each format's builder and checker, the clock allowance (60 seconds) and size caps, and
  the three test files.
- **Each side keeps:** its keys, where it sends and receives, and what an action does.
- **Fixed on the way:** `apps/server/src/cloud-backup.ts:57-67` builds the machine format by hand
  instead of calling the shared builder.
- **Risk:** a mismatch would stop every box talking to Cloud. The shared test files already prove
  both sides agree, and the code barely changes, which is why it goes first: it proves the publishing
  route on the safest code.

### 3b. Sign-in (with A1437 and Cloud's D608; ~500 lines)

- **Moves:** password hashing and checking (both already use the same scrypt format, so stored
  values work either side: `packages/identity/src/secret-hash.ts` and cloud:
  `packages/identity/src/secret-hash.ts`); the password length rule; authenticator codes (making the
  secret, the link for the app, checking a code one 30-second step either side); recovery codes
  (making, typing and hashing); the passkey settings; and A1437's new decision "what this sign-in
  needs next" (§1 of `docs/superpowers/specs/2026-11-09-a1437-dashboard-sign-in-rules-design.md`).
- **Each side keeps:** where accounts, codes and passkeys are stored (Waitron's database layer
  against Cloud's own SQL), sessions, routes and screens.
- **Where the copies differ today, so one must win (choices 6b–6d):** minimum password length (8 in
  Waitron, `verify-password.ts:5`; 15 in Cloud, cloud: `packages/registration/src/account-input.ts:6`);
  recovery codes (Waitron: 64 bits, stored as a plain hash, `mfa.ts:66-80`; Cloud: 128 bits, hashed
  together with the account, cloud: `authenticator-factor.ts:158-164`); passkeys (Waitron prefers a
  passkey the device can offer by itself, `passkey.ts:177`; Cloud requires it, cloud:
  `passkeys.ts:90`); and `otplib` 13.6.0 against 13.5.0.
- **Found on the way:** Waitron's code check (`totp.ts:17-25`) keeps no record of a used code, so the
  same code is accepted again until it expires; Cloud records used codes (cloud:
  `password-login.ts:57-70`). The shared check answers which 30-second step matched, and each side
  stores it and refuses a step already used.
- **Risk:** changing Waitron's recovery-code or passkey settings means staff make new recovery codes
  or passkeys once. Before go-live that is acceptable (CLAUDE.md: no compatibility code before
  production).

### 3c. Messages (with Cloud's D610 and the email relay; ~400 lines)

- **Moves:** the fixed list of message kinds and the values each one takes, with their checks
  (email: invitation, password reset, email change; SMS: a sign-in code and confirming a phone
  number); the English and Spanish texts and the code that fills them in, for the kinds both send.
- **Each side keeps:** sending. Waitron sends through the venue's own mail server
  (`apps/server/src/smtp-send.ts`); Cloud relays for boxes and sends texts.
- **Where the copies differ:** the relay's fixed list already matches Waitron's three kinds (cloud:
  `packages/registration/src/relay-payload.ts:9`), but the wording does not ("Your Waitron
  invitation" against Cloud's relay's "Set up your Waitron account"), and Cloud's relay sends plain
  text only (cloud: `relay-smtp.ts`) where Waitron also sends HTML (`apps/server/src/account-email.ts`).
- **Why it waits:** Waitron has no client for Cloud's email relay yet, and SMS is designed, not built.
  Sharing pays off when the box first asks Cloud to send, so the box and Cloud check the same list.

## 4. How a change reaches Cloud

A change merged into Waitron's `main` under `packages/contract` publishes a new version;
Dependabot proposes it in Cloud within a day (it checks daily at 06:00 UTC); Cloud's CI runs its tests against it; a
Cloud pull request merges it. Building it means generalising `publish-ui.yml` and
`prepare-ui.mjs` to publish a second package with two more allowed peers (~150 lines), adding the
package to Cloud's Dependabot list, and a lint rule (as for the print agent in `eslint.config.js`)
that keeps the package free of Waitron's other packages.

A change to a signing format must reach Cloud before any box uses it: a new format gets a new name
(`…-v2`) that Cloud accepts first, never an edit to `v1`.

## 5. Order and size

1. **Publishing route plus signing** (3a and §4): ~400 lines, one Waitron pull request and one Cloud
   pull request. Its own small item.
2. **Sign-in** (3b): ~500 lines in the package, smaller in each side as their copies go; built with
   A1437's second step (email codes) and Cloud's D608, so the rules are written once.
3. **Messages** (3c): ~400 lines; built with Waitron's relay client and Cloud's D610.

## 6. Choices for the owner (each with a recommendation)

- **6a. One package or three.** Recommend one, `@waitron-io/contract`, with a folder per part: one
  release workflow and one Dependabot entry instead of three.
- **6b. Password length.** Recommend 15 characters for new passwords on both sides (Cloud's rule);
  existing Waitron passwords keep working until changed.
- **6c. Recovery codes.** Recommend Cloud's: 128-bit codes, stored hashed with the account they belong
  to. Every Waitron account with an authenticator makes new codes once.
- **6d. Passkeys.** Recommend Cloud's "required", so the browser can offer every passkey without
  the email being typed first, as A1437's "a passkey signs you in alone" needs.
- **6e. Order.** Recommend signing first (smallest, already pinned by shared test files), then
  sign-in with A1437, then messages with the relay.
