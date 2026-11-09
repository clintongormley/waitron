# A1308 pp5 — two-step secrets sealed the one way, and `WAITRON_ACCOUNT_KEY` removed: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox
> (`- [ ]`) syntax. Every step also follows
> [the A1308 slice rules](2026-11-08-a1308-slice-rules.md) ("rules" below), which this plan cites
> and does not repeat.

**Goal:** a person's two-step (authenticator) secret and a pending two-step setup are sealed by
`@waitron/credentials`' `seal`/`open`, with the purpose `totp` bound into the sealed value and a key
for that purpose derived from the vault key ring. The emailed 10-minute code's keyed hash uses an
`account-action-code` purpose key from the same ring. `WAITRON_ACCOUNT_KEY`, which only existed to
derive those two keys, is removed everywhere. A vault key change re-seals the two-step secrets and
keeps codes issued just before it working (measurement 7).

**Words used here.** *Sealing* is encrypting a value so that only the right key opens it and any
tampering is detected (AES-256-GCM). *Binding the purpose* means the purpose name is mixed into the
seal, so a value copied into another purpose's column will not open (`packages/credentials/src/cipher.ts:24-29`).
The *vault key ring* is `WAITRON_CREDENTIALS_KEY` and, during a key change, the previous key
(`packages/credentials/src/keyring.ts:15-19`).

**Architecture:** two small functions in `@waitron/credentials` turn `seal`/`open` into one text
value with its key version; identity's `mfa.ts` stops having its own cipher. Every place that built
a "TOTP key ring" from the account key passes the vault ring instead. The rotation command gains the
two-step rows. The mirror join bundle, `trading.env`, first setup and the backup check stop
carrying or reading the account key.

**Tech stack:** TypeScript, Node `crypto`, Drizzle on `node:sqlite`, Vitest.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §5 U7 ("`WAITRON_ACCOUNT_KEY` is
removed … two-step secrets move to the one sealing method, with a key per purpose"; "No new rotation
commands are built"); [people appendix](../specs/2026-11-02-rationalisation/tables-people.md) §6
item 8 and §8 item 7; [environment appendix](../specs/2026-11-02-rationalisation/environment.md)
"What removing the account key reaches" (lines 92-105), its row for `WAITRON_ACCOUNT_KEY` (line
278), §5 measure 7 (lines 602-604).

**First line of the pull request:** "Two-step sign-in secrets saved before this cannot be opened:
on a development box, set two-step sign-in up again or reset the venue. No table changes."
(No starting migration changes, so rules §2's line does not apply; CLAUDE.md §3 "No
backwards-compatibility … code until Waitron is in production".)

**Who lands:** the lane. Nothing fiscal (rules §6). `trading.env` loses a secret, which U7 wants
("`trading.env` holds identity only, with no secret").

**Cites** read at `a086eedfb7`; slice 3a-ii ([plan](2026-11-08-a1308-3a-ii-mail-queue.md)) added a
third use of the account key at boot (`accountActionMail({ codeKey: accountPurposeKey(accountKey,
"account-action-code"), … })`, its boot wiring line).

**Waitron Cloud:** the mirror join bundle's `accountKey` field goes. README U11 says Cloud's test
script and integration contract change "in the same slice that changes the Waitron side … by the
Cloud lane"; the pull request names this as the Cloud lane's change in the same slice, and the
watcher queues it there. It is not a builder stop.

---

## What it builds

- In `packages/credentials/src/purpose-seal.ts` (exported from the package):
  - `purposeKey(entry: KeyEntry, purpose: string): Buffer` = HMAC-SHA256 of `entry.key` over
    `waitron.<purpose>.v1` (the same derivation `accountPurposeKey` used, now from the vault key).
  - `sealText(ring: KeyRing, purpose: string, plaintext: string): string`, giving
    `v2.<keyVersion>.<iv>.<tag>.<ciphertext>` (base64url parts; `v2` so a leftover `v1` value from
    `mfa.ts` is recognisably the old format), sealed with `purposeKey(ring.current, purpose)` and
    `aadFor(purpose)`.
  - `openText(ring: KeyRing, purpose: string, stored: string): { value: string; keyVersion: number } | null`,
    choosing the current or previous entry by the stored version; null on any failure, as `open`.
  - `purposeKeys(ring: KeyRing, purpose: string): Buffer[]`: the current purpose key, then the
    previous one when the ring has it.
- Identity: `persons.totp_secret` and a `totp_enrolment` row's `encrypted_secret` are written with
  `sealText(ring, "totp", …)` and read with `openText`. The emailed code's hash is made with
  `purposeKeys(ring, "account-action-code")[0]` and checked against each key in
  `purposeKeys(ring, "account-action-code")` with a constant-time compare.
  `encryptTotpSecret`, `decryptTotpSecret`, `TotpKeyRing`, `TotpKeyEntry` (`mfa.ts:6-62`) go;
  `replaceRecoveryCodes` and `consumeRecoveryCode` stay.
- Rotation re-seals two-step secrets (decision): identity exports `resealTwoStepSecrets`, which
  re-seals every `persons.totp_secret` and every `totp_enrolment` row not on the current key, each
  in its own transaction that re-reads the value and writes only if it is unchanged (so a fresh
  enrolment made during the run is never overwritten). The `waitron-credentials rotate` command
  calls it after the vault and signing-key rows; `@waitron/credentials` itself does not learn
  identity's tables (Task 3 step 4 says how the command is wired without a package loop). A value
  that does not open is left and counted `unopened`; the run goes on.
- `apps/server/src/account-key.ts` is deleted. Every boot path that built
  `{ current: { version: 1, key: accountPurposeKey(accountKey, "totp") } }` passes the vault ring
  (`apps/server/src/boot.ts:1693-1696` and the ten `credentialKeyRing: totpKeyRing` lines
  `:1863`, `:2156`, `:2173`, `:2647`, `:2729`, `:2829`, `:3332`, `:3410`, `:3500`, `:3537`); the
  account-action code key comes from the ring (`:2174`, `:2830`, and 3a-ii's `accountActionMail`).
- The account key leaves the mirror join bundle (`apps/server/src/mirror-bundle.ts:49-64`, `:100`,
  `:222`; `mirror-bundle-api.ts:55`, `:136`; `mirror-bundle-fetch.ts:46`; `adopt.ts:207`;
  `boot.ts:3409`, `:3452`), `trading.env` (`trading-config.ts:26`, `:38`; `boot.ts:1367-1371`;
  `first-setup-publication.ts:50`, `:72`), the backup placement check
  (`apps/server/src/backup-verification-secrets.ts:7`, `:36-38`: `verifyBackupKeyPlacement`
  compares only the key ring), first-setup command deployment
  (`packages/provisioning/src/first-setup-command-deployment.ts:244-251`) and identity's backup
  check (`packages/identity/src/backup-verification.ts:68-90`, which now uses `loadKeyRing(inputs)`
  and accepts `v2` values at any version the ring holds).
- Test helpers follow: `apps/server/src/testing/backup-verification-fixture.ts:279-284`,
  `handover-activation-kill-child.ts:128`, `apps/server/test/held-setup-database.ts:54`, `:161`,
  `apps/server/src/testing/authenticator.ts`, `packages/identity/test/fixtures.ts`.

## What it leaves out

| Left out | Owner |
| --- | --- |
| A rotation command or screen | none (README U7: "No new rotation commands are built"; `waitron-credentials rotate` exists already, `packages/credentials/src/cli.ts:55`) |
| One master key and secrets sealed to it | A1323 (README U7) |
| A refusal of a leftover `WAITRON_ACCOUNT_KEY` line in an old `trading.env` | none (environment appendix: no "refuse a retired name" check; a leftover line is ignored) |
| The one module that lists every variable | the environment-variables slice (batch 3) |
| Re-sealing the emailed codes | impossible (a keyed hash, appendix §6 item 8); the previous key is tried instead |

## Files

- Create: `packages/credentials/src/purpose-seal.ts`, `purpose-seal.test.ts`;
  `packages/identity/src/reseal.test.ts`.
- Modify (credentials): `packages/credentials/src/index.ts`, `cli.ts` (`CliDeps.resealers`, prints
  `unopened`), `bin.ts` (`runBin` takes resealers), `package.json` (the command declaration leaves),
  `rotate.test.ts`, `cli.test.ts`, `bin.test.ts`.
- Create (identity): `packages/identity/src/credentials-bin.ts`, `reseal.ts`; modify
  `packages/identity/package.json` (the command declaration and build script arrive).
- Modify (identity): `packages/identity/src/mfa.ts`, `profile.ts` (enrol and confirm), `manager-login.ts`
  (two-step check), `account-action.ts` (code hash and check), `passkey.ts` and `google-oidc.ts`
  (only their `TotpKeyRing` parameter types, if they carry one: grep), `backup-verification.ts`,
  `index.ts`, `test/fixtures.ts`.
- Modify (server): `account-key.ts` (delete), `boot.ts` (lines above), `trading-config.ts`,
  `first-setup-publication.ts`, `mirror-bundle.ts`, `mirror-bundle-api.ts`, `mirror-bundle-fetch.ts`,
  `adopt.ts`, `management-api.ts:933`, `:1096`, `promote-api.ts:197`, `mirror-bundle-api.ts:171`,
  `operation-authentication.ts:121`, `carry-on.ts:278`, `me-api.ts`, `fresh-sign-in.ts`,
  `node-operation-preparation.ts`, `promotion-operation.ts`, `handover-source-start-api.ts`,
  `waiting-start.ts`, `backup-recovery-pack-api.ts`, `backup-verification-secrets.ts` (each only where it types or passes the TOTP
  ring or the code key: the grep in Task 3 step 1 is the list), and the account-mail owner 3a-ii
  added (`apps/server/src/account-mail.ts`).
- Modify (provisioning): `packages/provisioning/src/first-setup-command-deployment.ts:244-251`.
- Tests: the new ones below, plus every existing test or test helper that builds an account key or
  a TOTP ring or names `accountKey`/`WAITRON_ACCOUNT_KEY` (38 files at `a086eedfb7` by the review's
  count; `git grep -lE "accountKey|WAITRON_ACCOUNT_KEY|resolveAccountKey|accountPurposeKey|TotpKeyRing|totpKeyRing" -- '*.test.ts' 'apps/*/test/*' 'apps/server/src/testing/*' 'packages/*/test/*'` is the list).
- Docs: `docs/developers/conventions-data.md` or `deploy/README.md` only if they name the account
  key (`git grep -n "ACCOUNT_KEY\|account key"`; none at `a086eedfb7` outside the specs); the
  environment appendix's measure 7 is answered in the pull request, not by editing the spec.

## Size

| Part | Counted lines (estimate) |
| --- | --- |
| `purpose-seal.ts` | 70 |
| Resealer, `CliDeps.resealers`, command entry move | 110 |
| Identity: `mfa.ts`, profile, manager-login, account-action, backup check | 110 |
| Server: account key removed from boot, bundle, trading config, first setup, backup placement; ring passed through | 165 |
| Provisioning | 15 |
| New tests: seal/open, rotation, resealer, measurement 7 (five cases), placement | 320 |
| Existing test re-points (38 files: ring and key helpers) | 150 |
| **Total** | **≈ 940** |

Uncounted: `account-key.ts` and the deleted parts of `mfa.ts` and the bundle.

## Finish line

```bash
pnpm --filter @waitron/credentials exec vitest run src/purpose-seal.test.ts src/rotate.test.ts src/cli.test.ts \
  src/bin.test.ts src/store.test.ts
pnpm --filter @waitron/identity exec vitest run src/mfa-encryption.test.ts src/profile.test.ts src/manager-login.test.ts \
  src/account-action.test.ts src/backup-verification.test.ts src/sealing-rotation.test.ts src/reseal.test.ts
pnpm --filter @waitron/server exec vitest run src/boot.test.ts src/mirror-bundle.test.ts src/mirror-bundle-api.test.ts \
  src/mirror-bundle-fetch.test.ts src/adopt.test.ts src/first-setup-entry.test.ts src/trading-config.test.ts \
  src/management-api.test.ts src/me-api.test.ts src/operation-authentication.test.ts src/promote-api.test.ts \
  src/waiting-start.test.ts src/backup-verification.test.ts src/backup-verification-secrets.test.ts
pnpm --filter @waitron/provisioning exec vitest run src/cli-first-setup.test.ts
pnpm exec vitest run scripts/deploy-image-env.test.ts
git grep -nE 'WAITRON_ACCOUNT_KEY|accountKey|accountPurposeKey|resolveAccountKey|TotpKeyRing|encryptTotpSecret|decryptTotpSecret' -- apps packages scripts deploy; test $? -eq 1
```

## Expected protection-list difference

None. The report must print `EQUAL` (no table, column, index, CHECK or trigger changes). Any line
is a stop.

## Stop points (beyond rules §5)

1. **Measurement 7 fails after the implementation** (Task 3 step 5 or Task 4 step 4): a person enrolled before a vault key
   change cannot sign in with their authenticator after it, or a code emailed before it fails inside
   its 10 minutes. The design says "the rotation is not finished": do not ship; stop with the
   failing case.
2. A947 or A1018 work in flight changes `mirror-bundle.ts` or `adopt.ts` (rules §8): rebase onto
   it; if it adds a new reader of `accountKey`, stop.

## Needs

- pp2 (`sign_in_challenges`, whose `totp_enrolment` rows this re-seals); pp3 (the account-action
  code paths after `target_email` goes).
- Slice 3a-ii (its account-mail owner is one of the code-key users). The Cloud lane's matching
  change (above) in the same slice.

---

## Global Constraints

- Rules §1–§9. Codex builds, Claude reviews.
- No secret value is printed or logged by any test or command (global rule: never print a secrets
  file; CLAUDE.md §3 personal-data and `redactSecrets` rules).
- `open`'s rule stands: a value that does not open answers null, never a reason
  (`cipher.ts:41-48`).
- Every commit `git commit -s`.

## Review Focus

1. **A value moved between purposes does not open** (`totp` sealed, opened as
   `account-action-code`, and the reverse): the purpose binding is the point of the change.
2. **Rotation leaves no unreadable two-step secret** when the previous key is present, and counts
   rather than crashes on one it cannot open.
3. **The code check tries the previous key only** when the ring has one; a code made under a key
   the ring no longer holds is refused like a wrong code.
4. **Every reader of the account key is gone**: the finish line's last grep.

---

### Task 1: Sealing by purpose in `@waitron/credentials`

**Files:** create `packages/credentials/src/purpose-seal.ts`, `purpose-seal.test.ts`; modify `index.ts`.

**Interfaces:** as in "What it builds".

- [ ] **Step 1: Write the failing tests:** `"seals and opens text under a purpose"`, `"refuses to
  open under another purpose"`, `"opens a value sealed under the previous key while the ring holds
  it"`, `"answers null for a value sealed under a key the ring does not hold"`, `"answers null for a
  tampered value"`, `"answers null for an old v1 value"`, `"stamps the current key version"`,
  `"derives different keys for different purposes and versions"`, `"lists the previous purpose key
  after the current one only when the ring has it"`.
- [ ] **Step 2: Run, see them fail. Step 3: Implement. Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** `git commit -s -m "Seal text by purpose with a key per purpose from the vault ring"`.

### Task 2: Measurement 7, written first

**Files:** create `packages/identity/src/sealing-rotation.test.ts` (`useVenueDb`).

The test drives the real flows through the identity functions and the real command entry, with a
ring of version 1, then a ring of version 2 whose previous entry is version 1 (as an operator sets
`WAITRON_CREDENTIALS_KEY_PREVIOUS*` for a key change), then `rotate`.

- [ ] **Step 1: Write the tests:**
  - (1) `"a person enrolled before a vault key change signs in with their authenticator after it"`:
    enrol (`profile.ts` start and confirm) under ring v1; switch to ring v2 with v1 as previous; run
    the rotation (`runCli(["rotate"], …)` with identity's resealer); sign in with a code from the
    same authenticator secret (the two-step check in `manager-login.ts`) under ring v2 with no
    previous entry: succeeds. The stored `totp_secret` now carries version 2.
  - (2) `"a code emailed before a vault key change works inside its ten minutes"`: issue an
    email-change code under ring v1; switch to ring v2 with v1 as previous; confirm within the
    window: succeeds.
  - (3) `"that code is refused once the previous key is gone"`: same, with ring v2 and no previous:
    refused with the code a wrong code gives.
  - (4) `"a pending two-step setup started before the change can be confirmed after it"`: start
    under v1; switch; rotate; confirm under v2 alone: succeeds.
  - (5) `"rotation does not overwrite a two-step setup made while it ran"`: between the re-seal's
    read and its write of a person's secret, a fresh enrolment replaces the secret (a hook in the
    test); the fresh secret survives and still opens.
- [ ] **Step 2:** Leave them uncommitted until Task 3 step 3, where they are first run red.

### Task 3: Identity and credentials use the ring

**Files:** identity and credentials files above.

- [ ] **Step 1: List every user** with
  `git grep -n "TotpKeyRing\|totpKeyRing\|encryptTotpSecret\|decryptTotpSecret\|codeKey\|accountActionCodeKey\|resolveAccountKey\|accountPurposeKey" -- apps packages ':!*.test.ts'`.
  This list is the Task 3–4 file list; a file outside the Files section is rules §5.5 unless it
  only types or passes the ring.
- [ ] **Step 2: Seal on the vault ring, current key only.** In identity: `mfa.ts` drops its cipher;
  enrol, confirm and the two-step check call `sealText`/`openText` with purpose `totp` and the ring
  they are given (type `KeyRing` from `@waitron/credentials`); the account-action code is hashed and
  checked with `purposeKeys(ring, "account-action-code")[0]` only. Identity's backup check builds
  its ring with `loadKeyRing(inputs)` only (`:68-90` goes) and its `totp` check accepts
  `v2.<version>.…` for any version in the ring, `unsupported` for any other prefix, and throws
  `BackupCheckUnavailable("decryption_unavailable")` when the ring cannot open a well-formed value
  (as today, `:120`). Wire boot's ring through (Task 4 step 3's boot part) so the tests run.
- [ ] **Step 3: Run Task 2's tests now. Tests (1), (2) and (4) must fail here** — nothing
  re-seals yet, and the code check does not try the previous key — and (3) must pass. That is
  measurement 7's failing result observed before the fix (environment appendix measure 7: "If either
  fails, the key change must re-seal `persons` and try the previous key"). Record the run.
- [ ] **Step 4: Finish the rotation.**
  - The code check tries each key in `purposeKeys(ring, "account-action-code")` (current, then
    previous) with a constant-time compare.
  - Identity exports `resealTwoStepSecrets(db: Database, ring: KeyRing): Promise<ResealResult>`
    (`{ rotated, alreadyCurrent, unopened }`): for every `persons.totp_secret` and every
    `sign_in_challenges` row of kind `totp_enrolment` whose stored version is not current, one
    `withTransaction` per row that re-reads the value, opens it, re-seals it, and writes it only if
    the stored value is still the one read (`update … where id = ? and totp_secret = <read value>`;
    the same for `encrypted_secret`), so a fresh enrolment made meanwhile is never overwritten. A
    value that does not open is left and counted `unopened`; the run goes on.
  - `@waitron/credentials` does not learn identity's tables: `CliDeps` gains
    `resealers: readonly ((db: Database, ring: KeyRing) => Promise<ResealResult>)[]`, and `rotate`
    runs each after the vault and signing-key rows, adding their counts and printing `unopened`.
    `runBin` takes the resealers as a parameter. Because identity depends on credentials, the
    `waitron-credentials` command's entry moves (owner, 2026-11-09: confirmed) to a small `packages/identity/src/credentials-bin.ts`
    that calls `runBin(argv, env, io, [resealTwoStepSecrets])`; the `waitron.commands` declaration
    and the build script move from `packages/credentials/package.json` to
    `packages/identity/package.json`. Any image or guard that names the command's path
    (`deploy/Dockerfile`, `scripts/deploy-image-env.test.ts`, `scripts/bundle-node.mjs` callers:
    grep `credentials/dist/bin`) follows in this pull request.
  - Add to `rotate.test.ts`: `"runs each resealer after the vault and adds its counts"`; to identity:
    `"re-seals two-step secrets and pending setups onto the current key"`, `"counts a secret it
    cannot open and goes on"`.
- [ ] **Step 5: Run** Task 2's tests (all pass now) and the credentials and identity finish-line
  runs.
- [ ] **Step 6: Commit** `git commit -s -m "Seal two-step secrets and emailed codes with the vault ring; rotation re-seals them"`.

### Task 4: The account key leaves the server and provisioning

**Files:** server and provisioning files above, and their tests.

- [ ] **Step 1: Write the failing tests:**
  - `trading-config.test.ts`: `"writes no account key to trading.env"`.
  - `mirror-bundle.test.ts`: `"the join bundle carries no account key"`; `mirror-bundle-fetch.test.ts`'s
    expected key list loses `accountKey` (`mirror-bundle-fetch.ts:46`).
  - `first-setup-entry.test.ts` (it drives `withFirstSetupPublication`) and
    `packages/provisioning/src/cli-first-setup.test.ts` (it drives
    `createFirstSetupCommandDeployment`): no `WAITRON_ACCOUNT_KEY` written.
  - `backup-verification-secrets.test.ts`: `"placement compares only the key ring"` — two archives
    whose rings match pass `verifyBackupKeyPlacement` whatever account-key line either holds.
  - `boot.test.ts`: `"a box with a leftover WAITRON_ACCOUNT_KEY starts and ignores it"`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement**: delete `account-key.ts`; pass `ring` where boot passed `totpKeyRing`;
  build each code key from the ring; drop the bundle field, the trading-config field and the
  first-setup writes; `backup-verification-secrets.ts`' `keys()` returns the ring alone. Update the
  test helpers in "What it builds".
- [ ] **Step 4: Run** Task 2's measurement-7 tests and the server and provisioning finish-line
  runs; expect pass (Stop point 1 if Task 2 fails).
- [ ] **Step 5: Commit** `git commit -s -m "Remove WAITRON_ACCOUNT_KEY: every purpose key comes from the vault ring"`.

### Task 5: Protection list, finish

- [ ] **Step 1:** Protection list before and after: expect `EQUAL`.
- [ ] **Step 2:** In the pull request, answer the environment appendix's measure 7 with Task 2's
  test names and both runs (red at Task 3 step 3, green at step 5). The design asked for a dev-box
  run; these tests run the same flows through the same functions with real keys and a real
  database, and the pull request says they are not a run on a box.
- [ ] **Step 3:** Run the finish line; `/finish-branch`.
