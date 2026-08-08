# First venue admin's initial dashboard password

**Date:** 2026-08-08
**Status:** design approved (owner, 2026-08-08)
**Owner decisions:** the initial dashboard password is **required** at venue provisioning; **no**
force-change-on-first-login.

## Problem

The management dashboard's auth floor is complete (slices 1a–1d, #67/#69/#70/#71), but there is no way
to perform a *first* dashboard login. `waitron-provision venue` seeds the first admin with a till
**PIN** (`persons.pin_hash`) but no dashboard **password** (`persons.password_hash` is left NULL), and:

- `loginManager` treats a NULL `password_hash` as `password.invalid`
  (`packages/identity/src/manager-login.ts:30-32`) — a passwordless person cannot log into the
  dashboard.
- `setPassword` can grant a password, but it is gated on an existing authenticated management session
  (`authorizeManager(… "person.manage")`, `packages/identity/src/staff.ts:91-94`) — you must already be
  logged in to use it. Its own doc reserves the first admin for provisioning
  (`staff.ts:83-86`).
- Passkey enrollment is likewise session-gated (`beginPasskeyRegistration`/`finishPasskeyRegistration`
  resolve a management session first, `packages/identity/src/passkey.ts:102-106,145-156`).

So every credential path except the provisioning seed requires an already-authenticated admin — a
bootstrap deadlock. This spec closes it by having `venue` seed the first admin's dashboard password.

## Goal

After `waitron-provision venue`, the seeded admin can log into the management dashboard with their
display name + the provisioned password, and from there grant staff their own credentials (passwords
via `setPassword`, passkeys via the register ceremony).

Non-goal: any reset/recovery flow, or credentialing anyone other than the first admin (that is what the
gated dashboard paths are for).

## Approach — extend `venue` (chosen over a standalone command)

The first admin is created at the `seed-admin` step of `applyVenue`, so the initial password belongs
there — the same place, and the same shape, as the PIN already handled. A standalone
`set-admin-password` command was considered and rejected as YAGNI: `venue` closes the greenfield gap,
and per CLAUDE.md §3 there is no backwards-compatibility to serve (nothing is deployed; developer
databases are recreated, so an already-provisioned-without-password DB is not a case we carry).

No schema migration: `persons.password_hash` already exists (nullable `text`, CHECK
`password_hash is null or length > 0`; `packages/identity/src/schema/persons.ts:41,69-72`, migration
`packages/identity/drizzle/0004_nosy_naoko.sql`). The admin row will now always carry a hash; other
persons still start password-less until `setPassword`.

No grant change: `applyVenue` runs as the **table owner** under the tenant GUC
(`packages/provisioning/src/venue-apply.ts:9-12,58`), and `password_hash` is a column of the `persons`
table it already inserts into. Proven owner-writes-persons-under-RLS by
`packages/provisioning/src/venue-apply.node-privilege.rls.test.ts`.

## The change, layer by layer

### 1. CLI (`packages/provisioning/src/cli.ts`) — mirror the PIN exactly

- New constant `ADMIN_PASSWORD_VARIABLE = "WAITRON_ADMIN_PASSWORD"` beside `ADMIN_PIN_VARIABLE`
  (`cli.ts:69`).
- Read the password the same way the PIN is read (`readAdminPin`, `cli.ts:734-738`): from the
  `WAITRON_ADMIN_PASSWORD` env var, else an **echo-off** `promptSecret` prompt. **Never argv** — the
  parser stays `strict`, so `--password` / `--admin-password` remain parse errors (existing test
  `cli.test.ts:225`).
- Validate at the boundary: `assertPasswordLength(adminPassword)` (≥8 → `password.too_short`;
  `packages/identity/src/verify-password.ts:5-11`), the analogue of `assertPinLength` (`cli.ts:411`).
- Hash at the boundary: build `admin: { displayName, pinHash: hashPin(adminPin), passwordHash:
  hashPassword(adminPassword) }` (`cli.ts:435`; `hashPassword` from `@waitron/identity`,
  `packages/identity/src/verify-password.ts:13-15`).
- Required: an absent password (no env, empty prompt) fails, exactly as the PIN does.

### 2. Plan (`packages/provisioning/src/venue-plan.ts`) — thread the hash through

- `VenueRequest.admin` gains `passwordHash: string` (`venue-plan.ts:35`).
- The `seed-admin` `VenueAction` gains `passwordHash: string` (`venue-plan.ts:40`).
- `planVenue` copies it straight through (pure; no DB) (`venue-plan.ts:107-147`).
- `describeVenueAction` MUST keep printing the admin **name only**, never the hash
  (`venue-plan.ts:155-158`) — asserted by a test.

### 3. Apply (`packages/provisioning/src/venue-apply.ts`) — add the column

The `seed-admin` insert (`venue-apply.ts:87-91`) becomes:

```sql
insert into persons (tenant_id, display_name, pin_hash, password_hash, role)
select ${tenantId}, ${action.displayName}, ${action.pinHash}, ${action.passwordHash}, 'admin'
where not exists (
  select 1 from persons where tenant_id = ${tenantId} and role = 'admin')
```

Drizzle-parameterised (`$n` binds), as today — not a utility statement, so no `quoteLiteral`. The
insert-where-not-exists idempotency (one admin per tenant) is unchanged.

### 4. Schema — none. (See Approach.)

## Secret discipline (existing conventions, now applied to the password)

Per CLAUDE.md §3 and the CLI's "§ SECRET DISCIPLINE" block (`cli.ts:414`):

- **Never in argv** — env var or echo-off prompt only; the `strict` parser rejects `--password`.
- **Never printed or logged** — the plan summary and `Cluster:` line already show name/host/port only
  (`cli.ts:463-466`, `venue-plan.ts:155-158`); `describeVenueAction` stays name-only (tested).
- **Length floor ≥8** at the boundary (`assertPasswordLength`).
- The password is a one-way scrypt hash (`packages/identity/src/secret-hash.ts`), never recoverable and
  never vaulted — unlike a `totp_secret`.

## Runbook

Both runbooks are stale for the admin seed and must be corrected in this change (a README that
paraphrases behaviour is a receipt that goes stale — CLAUDE.md §1):

- `packages/provisioning/README.md` (venue section, ~197-232): document `WAITRON_ADMIN_PASSWORD`
  alongside `WAITRON_ADMIN_PIN`; add both to the secrets table (the PIN is currently missing too); add a
  one-line "first dashboard login: sign in with the admin's display name + this password" note.
- `apps/server/README.md` ("Provisioning a venue", ~264-300): fix the worked example, which currently
  omits `--admin-name` and any mention of `WAITRON_ADMIN_PIN` (both now required/prompted), and add
  `WAITRON_ADMIN_PASSWORD`.

## Testing (TDD — failing test first, then the minimal change)

- **`venue-plan.test.ts`** (pure): `seed-admin` carries `passwordHash` straight from the request (extend
  the existing `:47-56` assertion); `describeVenueAction` prints the name and **never** the password
  hash (extend `:197-205`).
- **`venue-apply.test.ts`** (PGlite): the seed-admin read-back also asserts `password_hash` is the
  seeded hash (extend `:81-98`); idempotency (one admin across re-runs) unchanged (`:112-125`).
- **`venue-apply.node-privilege.rls.test.ts`** (real Postgres): confirm the owner-admin seeds the admin
  row *including* `password_hash` with no widened grant (the existing owner-writes-persons proof already
  covers the column-level privilege; assert the value round-trips).
- **`cli.test.ts`**: the seed-admin action's `passwordHash` verifies via `verifyPassword` when the
  password comes from `WAITRON_ADMIN_PASSWORD` env (mirror the PIN assertion at `:1041`); the echo-off
  prompt path when the env is unset (mirror `:1079-1099`); `--password` / `--admin-password` refused as
  flags (extend `:225`); a too-short password → `password.too_short`.
- **Gap-closing end-to-end** (PGlite, in `venue-apply.e2e.test.ts` or a focused new test): after
  `applyVenue` seeds the venue, `loginManager({ id: <admin>, tenantId, password })` **succeeds** and
  mints a management session — the direct proof the bootstrap deadlock is gone. A negative control: the
  wrong password → `password.invalid`.
- Every guard proven by deletion where applicable (remove the change, watch the new assertion fail).

## Out of scope (recorded)

- A standalone `set-admin-password` / reset command (YAGNI; `venue` closes the greenfield gap).
- Force-change-on-first-login (decided: no — for the single-owner deli, the operator-set password *is*
  the admin's password; a forced change is empty ceremony and would add a `persons` flag + a dashboard
  change-password flow).
- Credentialing any non-admin person at provisioning (that is the gated dashboard paths' job).
