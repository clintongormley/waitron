# Onboarding Slice 4c — Break-glass admin recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give an operator with physical possession of a locked-out box a way to reset the admin credential — an on-box `waitron-break-glass` CLI that resets the admin's dashboard password (and PIN) and reactivates a suspended admin, for the box's single tenant — plus a **design-only** note on the chain-destructive factory reset (which stays unbuilt).

**Architecture:** The first-admin has no self-service password reset, and every existing reset (`staff.ts` `setPassword`/`resetPin`) is gated on an authenticated `person.manage` session — exactly what a locked-out sole admin cannot obtain. Break-glass is a standalone CLI (mirroring `register-till.ts` / `waitron-recovery`) whose gate is physical/shell access to the box + the box's `DATABASE_URL` (loopback-bound, `0600` `trading.env`) — the "router-style local console" of spec §12. It runs `withTenant(WAITRON_TILL_TENANT_ID)` as `waitron_app` (which holds `UPDATE` on `persons` under FORCE RLS), finds the `role='admin'` person, and sets a new scrypt-hashed credential supplied via env (never argv). Factory reset is design-only.

**Tech Stack:** TypeScript ESM (`.js` specifiers), Node, `@waitron/db` (`withTenant`, `createPostgresDb`), `@waitron/identity` (`hashPassword`/`hashPin`), Drizzle, Vitest + real Postgres.

**Spec:** `docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md` §12 (break-glass) + §17 (open mechanism question). Backlog "4c". Fourth and final onboarding-4 slice (4a #159, 4b-i #161, 4b-ii #163, 4b-iii runbook landed).

## Global Constraints

- **No new SQL-injection surface:** the CLI builds no SQL by string concat; Drizzle parameterises the `persons` UPDATE. The connection string is read only from `DATABASE_URL` (env), never argv (process-table leak); the **new credential is read only from env** (`WAITRON_BREAKGLASS_PASSWORD` / `WAITRON_BREAKGLASS_PIN`), never argv — mirroring `register-till.ts` / `recovery-unpack-command.ts`.
- **RLS:** `persons` is FORCE RLS + `persons_tenant_isolation`; the UPDATE affects zero rows outside `withTenant`. Always run inside `withTenant(db, tenantId, …)` with `tenantId = WAITRON_TILL_TENANT_ID`.
- **Never widen a grant / never reset without a tenant.** `waitron_app`/`app_user` already holds `SELECT, INSERT, UPDATE` on `persons` — sufficient. Do NOT reach for a more-privileged role.
- **The ungated reset is confined to the break-glass command** — do NOT add a reusable ungated credential-reset export to `@waitron/identity` (that would be a footgun any code could call). The command does the `withTenant` UPDATE directly, using identity's `hashPassword`/`hashPin`.
- **Error codes** name the DOMAIN concept; if any are thrown, they are `break_glass.*` (or reuse existing). Files that throw import `./errors.js`. `AppError.message === code`.
- **Gate:** `pnpm --filter @waitron/server lint && typecheck`, `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (real PG for the reset — app_user under RLS is a false pass on PGlite, CLAUDE.md §4), `pnpm format:check`. `git commit -s`.

## Controller rulings (recorded for the user)

- **R1 — Mechanism = on-box CLI**, not a loopback HTTP endpoint. No per-request loopback gating exists in the tree; a CLI whose gate is physical shell + the box's `DATABASE_URL` is the precedented idiom (register-till, waitron-recovery) and is what spec §17 / the 4a plan anticipated ("loopback CLI"). *Cost if wrong: a different physical-gate mechanism (held button / recovery-boot) would need firmware, which is parked.*
- **R2 — Resets the admin's password + PIN + reactivates** (a suspended admin can't log in even with a fresh password). Target `role='admin'` for the box's single `WAITRON_TILL_TENANT_ID`. New credential via env. *Cost if wrong: an over-broad reset; mitigated by targeting only the admin role and logging the action.*
- **R3 — Multiple admins (schema allows N): refuse + list, require an explicit `--person <id>`.** Zero admins: error. *Cost if wrong: an operator must re-run with a person id in the rare multi-admin case.*
- **R4 — Passkey revocation is OUT of scope.** Resetting PIN/password does not touch `webauthn_credentials`; break-glass restores password access. Revoking a stolen-then-recovered box's stale passkeys is a separate hardening concern, noted in the design doc. *Cost if wrong: a recovered box keeps old passkeys valid until separately revoked.*
- **R5 — Audit = a structured log line** (`break_glass.admin_reset` with the person id, NEVER the new credential), mirroring `recovery.bundle_downloaded`. No DB audit table exists and none is added here. *Cost if wrong: the reset is only in the process log, not a queryable table.*
- **R6 — Factory reset is DESIGN-ONLY** (chain-destructive; warned loudly; unbuilt), per spec §12 "do not make factory-reset casual." Plus a dated spec §17 pointer marking the mechanism resolved.

## File Structure

**New:** `apps/server/src/break-glass-command.ts` (`runBreakGlassReset` core) + `.test.ts`; `apps/server/src/bin-break-glass.ts` (thin bin). **Modified:** `apps/server/package.json` (`waitron-break-glass` bin + esbuild build line); a new design doc `docs/superpowers/plans/2026-08-30-onboarding-slice4c-factory-reset-design.md`; a dated pointer in the spec (§17); `docs/backlog.md`.

---

## Task 1: Break-glass reset command core (`break-glass-command.ts`)

**Files:** Create `apps/server/src/break-glass-command.ts` + `apps/server/src/break-glass-command.test.ts`.

**Interfaces:**
- Produces: `runBreakGlassReset(deps: { argv: string[]; env: Record<string,string|undefined>; out: (line: string) => void; connect: (url: string) => Promise<Database> }): Promise<number>` — returns a POSIX exit code (0 success; 2 usage/config error; 1 operational error, e.g. no admin / ambiguous admin). Mirrors `runRecoveryUnpack`'s shape.
- Consumes: `hashPassword`, `hashPin` (`@waitron/identity`); `withTenant`, `type Database` (`@waitron/db`); `persons` table + `eq`/`and` (drizzle) — read how `staff.ts` `setPassword`/`resetPin` write `persons` (`packages/identity/src/staff.ts`) and mirror the UPDATE shape (columns `password_hash`, `pin_hash`, `status`).

**Behaviour:**
- Read `DATABASE_URL` (the box's connection) and `WAITRON_TILL_TENANT_ID` from env — both required (usage/2 if unset). Read the new credential from env: `WAITRON_BREAKGLASS_PASSWORD` (required — the dashboard lockout is the password) and `WAITRON_BREAKGLASS_PIN` (optional; if set, also reset the PIN). NEVER from argv.
- `argv` carries only an optional `--person <id>` to disambiguate multiple admins.
- Enforce `assertPasswordLength` on the new password (min 8, reuse identity's check) — a too-short break-glass password is a usage error.
- `connect(DATABASE_URL)`, then `withTenant(db, tenantId, async (tx) => { … })`:
  - `select id, status from persons where role = 'admin'` (RLS scopes to the tenant). 
  - 0 rows → `out("break-glass: no admin found for tenant …")`, return 1.
  - >1 row AND no `--person` → `out` the list of admin ids + "re-run with --person <id>", return 1.
  - Resolve the target (the sole admin, or the `--person` match — error 1 if `--person` names a non-admin/absent id).
  - `update persons set password_hash = <hashPassword(newPassword)>, [pin_hash = <hashPin(newPin)> if given,] status = 'active' where id = <target>` (reactivate). Assert exactly one row affected.
  - `out("break-glass: reset admin <id> (password[, pin], reactivated)")` — NEVER echo the new secret. Return 0.
- Close the db pool in a `finally`.

- [ ] **Step 1: Failing tests** (real Postgres, `useTemplateDb` + `applyVenue`/`planVenue` to seed a venue with an admin — mirror `box-status.route.test.ts`'s `setupTenant`). Cases, calling `runBreakGlassReset` with a fake `connect` returning `suite.admin` (or a real app_user pool) and env:
  1. **Restores login:** seed an admin with a known password; run break-glass with a NEW password; then assert `loginManager` (or `verifyPassword` against the row) SUCCEEDS with the new password and FAILS with the old — the real proof the reset took. Returns 0.
  2. **Reactivates a suspended admin:** set the admin `status='suspended'`; after break-glass, the row is `status='active'`.
  3. **Missing new password env → returns 2** (usage) and does NOT touch the row.
  4. **Too-short new password → returns 2**, row untouched.
  5. **No admin (delete/omit) → returns 1**, message names it.
  6. **Two admins, no --person → returns 1** + lists both ids; **with --person <id> → resets exactly that one**.
  7. **New credential is read from env, never argv:** assert passing the password as an argv element does NOT reset (it's ignored) — the secret only comes from `WAITRON_BREAKGLASS_PASSWORD`.
  Use `TESTCONTAINERS_RYUK_DISABLED=true`. Guard any self-owned pool teardown.
- [ ] **Step 2: Run → FAIL** (`pnpm --filter @waitron/server test break-glass-command`).
- [ ] **Step 3: Implement** `break-glass-command.ts` per the behaviour above. Prove-by-deletion: the RLS/withTenant is load-bearing — a version without `withTenant` updates zero rows (assert one test would catch that).
- [ ] **Step 4: Run → PASS.** Prove-by-deletion on the `withTenant` (drop it → the reset affects 0 rows → the login test fails); restore.
- [ ] **Step 5: Commit** `feat(onboarding): break-glass admin-reset command core (4c)`.

---

## Task 2: The `waitron-break-glass` bin

**Files:** Create `apps/server/src/bin-break-glass.ts`; modify `apps/server/package.json` (`bin` map + esbuild build line).

**Interfaces:** consumes `runBreakGlassReset`.

- [ ] **Step 1:** Read `apps/server/src/bin-recovery.ts` + `apps/server/package.json` for the exact thin-bin shape and the `bin`-map + esbuild build-line convention (a bin declared without its esbuild line ships inert — CLAUDE.md; #161 fixed exactly that).
- [ ] **Step 2:** Create `bin-break-glass.ts` — `#!/usr/bin/env node`, import `runBreakGlassReset`, call with `argv: process.argv.slice(2)`, `env: process.env`, `out: (l) => process.stdout.write(\`${l}\n\`)`, `connect: createPostgresDb`, `.then((code) => process.exit(code))`, wrapped in `/* v8 ignore start/stop */` (matching the sibling bins).
- [ ] **Step 3:** `package.json`: add `"waitron-break-glass": "./dist/bin-break-glass.js"` to `bin`, and add its `esbuild src/bin-break-glass.ts … --outfile=dist/bin-break-glass.js …` step to the `build` script (mirror `bin-recovery.ts`'s line exactly).
- [ ] **Step 4:** `pnpm --filter @waitron/server lint && typecheck && test break-glass`; confirm `pnpm --filter @waitron/server build` emits `dist/bin-break-glass.js` and it runs (prints usage, exits non-zero) with no env.
- [ ] **Step 5: Commit** `feat(onboarding): waitron-break-glass bin (4c)`.

---

## Task 3: Factory-reset design note + spec pointer (docs-only)

**Files:** Create `docs/superpowers/plans/2026-08-30-onboarding-slice4c-factory-reset-design.md`; add a dated pointer to `docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md` §17 (and/or §12).

- [ ] **Step 1: Write the factory-reset design note.** It is DESIGN-ONLY (nothing built). Cover: what a factory reset is (wipe + re-provision), **why it is chain-destructive and must never be casual** — a re-provision mints a fresh SIF / new installation number and starts a new chain (fiscal §5), stranding the old chain; it is the nuclear option, distinct from break-glass (which only resets a credential and preserves the chain). Router-style semantics considered (console command with a typed confirmation / held-button / recovery-boot) but **firmware-dependent → parked with slices 5–7**. State the guard-rails a future factory-reset must carry: an explicit typed confirmation naming the consequence, a loud warning that filed-but-lost records become unverifiable, and that it is never reachable from the normal UI. Cross-reference the cold-restore runbook (which is NOT a factory reset) and the disposal guard (design-only, voluntary retirement).
- [ ] **Step 2: Resolve spec §17.** Add a dated pointer at spec §17's break-glass open-question (and §12) noting: **break-glass mechanism resolved 2026-08-30 as an on-box loopback CLI (`waitron-break-glass`), landed in 4c** — resets the admin credential (password/PIN + reactivate) with no chain impact; factory reset stays design-only (firmware, parked). Do NOT rewrite the spec's history — add a dated note (CLAUDE.md: historical docs get a dated pointer, not a rewrite).
- [ ] **Step 3: Commit** `docs(onboarding): factory-reset design note + break-glass spec resolution (4c)`.

---

## Task 4: Gate + backlog

- [ ] **Step 1:** Full gate: `pnpm lint && typecheck && format:check` + `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`. Fix reds (apps/server floor 95/95/90/88).
- [ ] **Step 2:** Backlog: flip 4c to **implemented on `feat/onboarding-4c-break-glass`** (no PR number). Summarise: `waitron-break-glass` on-box CLI resets the admin password/PIN + reactivates (physical/shell gate, credential via env, `withTenant` under app_user RLS, logs `break_glass.admin_reset`); passkey-revocation out of scope (noted); factory-reset design-only; spec §17 resolved. Note that **Slice 4 (onboarding backup/status/break-glass) is now COMPLETE** (4a/4b-i/4b-ii/4b-iii/4c), with the remaining onboarding slices 5–7 (AP-mode firmware / OS image / paid) parked.
- [ ] **Step 3: Commit** `docs(backlog): break-glass (4c) implemented on branch; Slice 4 complete`.

## Self-Review notes
- The ungated reset must stay INSIDE the break-glass command — no reusable ungated identity export.
- The reset is proven by an actual login check (old fails, new works), not just a row write.
- `withTenant` is load-bearing (RLS) — prove by deletion.
- Secrets (new password/PIN) only from env, never argv — pin it with the argv-ignored test.
- Verify-not-assume: `staff.ts` UPDATE shape; `assertPasswordLength`'s export + min; the bin/esbuild convention; whether `loginManager` is importable in the test or whether to assert via `verifyPassword` on the row.
