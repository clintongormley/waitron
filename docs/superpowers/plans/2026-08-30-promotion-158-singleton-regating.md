# Plan — promotion #158 follow-on: re-gate the singleton duties onto `singleton_role`

**Date:** 2026-08-30
**Branch:** `feat/promotion-158-singleton-regating`

The one foundation-free piece of the promote work (owner decision 2026-08-29: "#158 re-gating only",
defer the full mirror→primary Slice 3). The four **primary-only background/source duties** are gated
at boot on `mode` (`const isMirror`), but they are SINGLETON duties — they must run on the one
`singleton_role='primary'` node, not on every non-mirror node. A **sell-only local secondary**
(`mode='primary'`, `singleton_role='secondary'`) therefore wrongly runs all four today, duplicating
the primary's work (two nodes pruning the shared `sync_log`, two dialing the one outbound tunnel, two
scheduled-backup writers, two authoritative sync sources). Re-gate them from `mode` onto
`singleton_role`.

Source: promotion-runbook-design.md §3c ("the primary-only background loops … (role/location
dependent) the sync-source activity and the tunnel client — are frozen at boot today as a
`const isMirror`") and §2 ("only the workers of §3c gate on [singleton_role]"). The fiscal
drain/reconcile pass already moved to `singleton_role` in #158 (`singletonPass`); this closes the
same gap for the remaining four.

## Global Constraints

- **No backwards-compat / migration code** — pre-production. Pure gating change: no schema, no new
  error codes.
- **Preserve behavioural assertions** (user pref) — do NOT rewrite a test to match new code. A
  normally-booted primary defaults to `singleton_role='primary'` (schema default), so it still runs
  all four; only a `(primary, secondary)` node changes. Update/add tests honestly.
- **TDD** — failing test first, prove by deletion.
- **Verify gate** (from `apps/server`): `pnpm lint && pnpm typecheck && pnpm format:check && pnpm
  test:coverage` (`TESTCONTAINERS_RYUK_DISABLED=true`). 98/98/98/95.
- **Real Postgres** where the boot path needs the deployment role / RLS; the existing
  `boot.*.test.ts` harness is the right level for "does this node run worker X".

## The change (all in `apps/server/src/boot.ts`)

Capture `const isSingletonPrimary = holders.singletonRole.current === "primary"` once at boot, beside
`const isMirror` (~boot.ts:710). Because the DB CHECK rejects `(mirror, primary)`,
`singleton_role='primary'` already implies `mode='primary'`, so this predicate alone is correct and a
mirror is always `secondary`. Re-gate these FOUR from `!isMirror` to `isSingletonPrimary`:

1. **Sync source** — `if (!isMirror) { mountSyncApi(...) }` (~boot.ts:1026). The authoritative
   replication source; only the singleton primary serves it. (Do NOT touch the sync PULL worker
   `runSyncPull` / the mirror-pull peer selection — a mirror pulls; that stays `mode`/mirror-gated.)
2. **Retention sweep** — `if (!isMirror && syncConfig.retentionDatabaseUrl !== undefined)` and its
   `else if (!isMirror)` warn branch (~boot.ts:1105 / 1121).
3. **Backup duty** — `if (!isMirror && backupConfig !== undefined)` and its `else if (!isMirror)` warn
   branch (~boot.ts:1160 / 1185). Added by #163, explicitly modeled on retention/tunnel as a
   primary-only singleton duty (the comment at ~boot.ts:1131 says so) — so it re-gates with them.
4. **Tunnel client** — `if (!isMirror && tunnelConfig !== undefined)` and its `else if (!isMirror)`
   warn branch (~boot.ts:1281 / 1299), plus any later `!isMirror` cleanup referencing the tunnel
   (~boot.ts:1311's `retentionDb` close is retention's, keep it consistent with retention's gate).

For each: the `else if (!isMirror)` "primary-only config missing" WARN must follow the gate — it
should fire for a **singleton primary** missing its config, not for a secondary that legitimately runs
nothing. So the `else if` becomes `else if (isSingletonPrimary)`.

**Do NOT touch:** the read-only gate, the ambient viewer, the mount gate (PR #164), the fiscal
`singletonPass` (already singleton-gated), or the sync PULL worker. Trace each `!isMirror` you change
and confirm it is one of the four duties above and not the pull/mirror path.

## The deferred caveat — document it in-code

These stay BOOT-time decisions (captured once, like `isMirror`). An in-process promotion (#160
`promoteLocalSecondaryToPrimary` flips `singleton_role` live) starts the fiscal pass next tick but
will NOT start these four without a restart — that live worker-lifecycle manager is promotion
**Slice 3** (runbook §3c, "the real new code"), deferred (gated on reserved-SIF staging). Add a
concise comment at the `isSingletonPrimary` capture naming this: the gate moved from `mode` to
`singleton_role` (fixing the active-active duplication), but live-start-on-promotion is Slice 3.

This does not regress any working flow: no `(primary, secondary)` topology is deployed yet, and
"starting the mode-gated workers at runtime" was already listed as a later slice; #160 only proved the
fiscal pass starts live.

## Tests (TDD)

Using the `boot.*.test.ts` real-PG harness:
- **New behaviour:** a `(primary, secondary)` node (stamp `mode='primary'`, `setSingletonRole('secondary')`)
  with retention/tunnel/backup/sync-source config all present does NOT mount the sync source and does
  NOT start retention / tunnel / backup. Prove by deletion (revert one gate to `!isMirror` → the
  secondary wrongly runs it → test red). Assert at least one duty per gate (e.g. the sync-source route
  is absent/present; the retention/backup/tunnel worker handles are undefined for a secondary).
- **Preserved:** a default primary (`singleton_role='primary'`, the schema default) STILL runs all
  four — confirm an existing primary-boot assertion still passes, or add one if none pins it.
- **Preserved:** a mirror (`mode='mirror'`) STILL runs none — unchanged.

Find the existing boot tests that assert a primary mounts the sync source / runs retention / tunnel /
backup and confirm they set (or default) `singleton_role='primary'`; if one boots a primary and
asserts these run, it must keep `singleton_role='primary'` so the assertion holds — do not weaken it.

## Out of scope
The full mirror→primary Slice 3 (live worker-lifecycle manager, reserved-SIF minting), Slices 2/4/5,
and any schema/holder-refresh change. This PR only moves four boot-time gate conditions.
