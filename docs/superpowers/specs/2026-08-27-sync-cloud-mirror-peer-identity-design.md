# Sync cloud-mirror — sub-project A: per-peer identity & auth

**Status:** design, awaiting owner review · **Date:** 2026-08-27 · **Branch:** `feat/sync-peer-identity`

## 0. Where this sits

"Build the sync cloud-mirror peer" (backlog top-tier #2) is three subsystems, to be proven
end-to-end against a **local stand-in cloud** (a second local Postgres + a reader process on another
port — no real hosting, DNS or TLS yet, because none exists: verified 2026-08-27, no Dockerfile, no
deploy workflow, no `apps/server` `start` script, no tunnel code in the tree). Each is its own
spec → plan → build:

- **A — Peer identity & auth (THIS spec).** Runs entirely on the box, needs no cloud. A DB-backed
  `sync_peers` registry, an enrolment core, a `waitron-sync-peer` CLI, and a rewrite of the sync-api
  auth so the source derives a caller's `subscriberId` from its token instead of trusting the request
  body. **This closes a real data-loss forge gap** (§2) and is the hard prerequisite for B and C.
- **B — Outbound-tunnel transport (later).** Invert the transport so the box always dials out and the
  cloud's pull rides back down the box-initiated tunnel; a local relay stand-in is the test harness.
  Authenticates with an A-issued per-peer token.
- **C — Cloud read-mirror (later).** A "mirror mode" of `apps/server` that pulls + applies into its
  own Postgres and serves the dashboard read-only. First real subscriber of the ordered lane, so the
  `dining_tables` FK-closure enrolment (the `fkRank` hard-gate) lands **here**, where it is needed.

This spec is **only A**. B and C are named for context and are explicitly out of scope (§10).

## 1. The scenario, in plain terms

Two Waitron nodes replicate a restaurant's data to each other by an application-level outbox: every
committed row is captured into a `sync_log` table, and a subscriber "pulls" the rows it has not yet
seen and re-applies them locally. Each subscriber reports back **how far it has caught up** (a
cursor). The node that holds the log **prunes** rows once *every* subscriber has reported past them —
that is how the log stays bounded.

We now want to add a **third subscriber that we do not fully trust**: a cloud copy kept offsite for
disaster recovery. Today every caller is trusted equally, which is fine for two nodes that trust each
other but not for a less-trusted mirror. Sub-project A gives each subscriber its **own identity**, so
the source can tell them apart and stop one from speaking for another.

## 2. The problem A fixes (with receipts)

The source's cursor endpoint takes the subscriber's identity **from the request body**, gated only by
a shared token that every node holds:

> `apps/server/src/sync-api.ts:153-173` — `POST /sync-api/cursor` reads `subscriberId` from the JSON
> body; the only gate is `requireNodeTokens` (`sync-api.ts:101-111`), a constant-time check against a
> **shared** set (`WAITRON_SYNC_NODE_TOKEN`, `config.ts:200-203`).

So **any holder of the shared token can advance any subscriber's cursor to any value.** Trace the
consequence to the unrecoverable end:

1. The retention sweep prunes `sync_log` to the **minimum** `last_applied_seq` across *all*
   subscribers (`packages/sync/src/retention.ts`, wired at `apps/server/src/boot.ts:719-731`).
2. A forged `POST /sync-api/cursor` for a *real* subscriber, carrying a `lastAppliedSeq` far ahead of
   what that subscriber has actually applied, raises that subscriber's reported cursor.
3. `recordSubscriberCursor` keeps the cursor **monotonic** (`greatest(excluded, existing)`,
   `packages/sync/src/cursor-report.ts:33-39`), so the inflated value cannot be walked back.
4. The next sweep prunes rows the real subscriber never received. They are **gone** — the source
   deleted its only copy, and the subscriber will never pull them. Silent, unrecoverable data loss.

For two mutually-trusting nodes this is acceptable — the shared token *is* the trust boundary. A
distrusting cloud mirror needs each subscriber bound to its own identity so it can only ever move its
**own** cursor. That is decision 1 below.

## 3. Locked decisions (design pass 2026-08-26 + owner answers 2026-08-27)

1. **Per-peer bearer token, identity derived from the token — never the body.** The source resolves
   the caller's `subscriberId` from its token and ignores any body-supplied value.
2. **DB-backed `sync_peers` registry, not config.** Chosen over a config map so a non-technical owner
   gets runtime revoke (no config edit, no restart), tokens hashed at rest, and an audit trail — the
   same enrolment shape printing/device-identity already use.
3. **Unified auth for every peer** (owner, 2026-08-27). Retire the shared `WAITRON_SYNC_NODE_TOKEN`.
   *Every* peer — the cloud mirror and any LAN active-active node — authenticates through
   `sync_peers`, and `/sync-api/cursor` drops the body `subscriberId` for all of them. Nothing is
   deployed, so there is no back-compat cost, and the forge gap closes uniformly rather than surviving
   on a shared-token path.
4. **CLI-mint enrolment**, not HTTP pairing-code redemption. The operator runs `waitron-sync-peer
   enrol` on the source, which mints the token and prints it once; the operator copies it into the
   peer's `WAITRON_SYNC_PEERS` config. (Pairing-code redemption is how print-agents enrol, but it
   requires the enrolling party to reach the source over HTTP — which the cloud, sitting behind the
   box's outbound-only tunnel, cannot do. Mint-and-copy matches the "mint → hash → store" shape and
   the connection direction.)
5. **v1 scope = single-tenant DR mirror.** The multi-tenant "whole-log reader" transport and the
   fiscal/hash-chain lane stay deferred (separate later slices).

## 4. Data model — `sync_peers`

A **node-level identity table**, modelled on `print_agents`
(`packages/db/src/schema/print-agents.ts`) **minus** the tenant/location scoping and the pairing
code. Peer identity is per-node **operational** state, like `sync_cursor`, so it deliberately carries
**no `tenant_id` and no RLS** — same rationale `sync_cursor` records at `0000_sync_outbox.sql:95-99`.
A welcome consequence: with no `tenant_id` column it is **out of the fiscal `inmutabilidad`
FORCE-RLS scan by construction** (that scan keys on the presence of a `tenant_id` column), so — unlike
a tenant-scoped table — it needs no FORCE/policy recipe.

| column | type | notes |
|---|---|---|
| `id` | `uuid` PK `defaultRandom()` | the bearer token's **selector** half |
| `subscriber_id` | `text` NOT NULL | the identity the token *is*; what auth returns; keyed to `sync_cursor.subscriber_id` (also `text`) |
| `name` | `text` NOT NULL | operator label, e.g. `"cloud DR mirror"` — shown by `list` and, later, C's dashboard |
| `token_hash` | `text` NOT NULL | scrypt hash via `hashSecret` (`@waitron/identity`); the plaintext token lives only in the peer's own config |
| `active` | `boolean` NOT NULL default `true` | revoke = flip to `false` (instant); **never** a hard delete |
| `last_seen_at` | `timestamptz` | NULL until first authenticated call; the "last heard from" sighting |
| `enrolled_at` | `timestamptz` NOT NULL default `now()` | creation stamp (no separate `created_at`, matching `print_agents`) |

**Token shape = `${id}.${secret}`** (selector `.` validator), exactly the print-agent token
(`agent.ts:159`). scrypt is per-row-salted, so the `id` selector is needed to fetch the salt before
`verifySecret`. **Rotation:** multiple `active` rows may share one `subscriber_id` — enrol a second
row, cut the peer over to the new token, then revoke the first. (Nothing enforces uniqueness on
`subscriber_id`; two rows for one subscriber is the supported overlap window, the per-peer analogue of
today's ≥2-member shared-token set.)

**Placement:** a new `packages/sync/drizzle/0005_sync_peers.sql` (hand-written `--custom`: drizzle-kit
models no roles/grants). It depends on no enrolled table, so its position last in the `sync`
migration set is fine.

## 5. Grants & roles (least privilege, reusing the two existing sync roles)

`sync_peers` has no RLS, so — like `sync_cursor` — plain object grants are the whole mechanism, no
policy. Two roles touch it, and they are deliberately **not** equally privileged:

- **`sync_tailer`** — the auth path. The sync-api pool is a `sync_tailer` member (`config.ts:246-248`)
  and reads the log through it. Grant it exactly:
  - `GRANT SELECT ON sync_peers TO sync_tailer;` — the token lookup in `authenticatePeer`.
  - `GRANT UPDATE (last_seen_at) ON sync_peers TO sync_tailer;` — **column-level**, so the auth path
    can stamp a sighting but **cannot flip `active`**. This is stricter than print-agents (whose
    `authenticateAgent` last-seen write runs under `app_user`'s full `UPDATE`), and deliberately so:
    the revocation control must not be writable by the hot path. Column-level `UPDATE` is standard
    PostgreSQL; the `WHERE` clause reads only `id`/`last_seen_at`, both covered by the `SELECT` grant.
- **`sync_retention`** — the operator/CLI path. `waitron-sync-evict` already connects as a
  `sync_retention` LOGIN member (`WAITRON_SYNC_RETENTION_DATABASE_URL`, `sync-evict.ts:24`), so
  `waitron-sync-peer` reuses that connection. Grant it:
  - `GRANT SELECT, INSERT, UPDATE ON sync_peers TO sync_retention;` — enrol (INSERT), revoke/rotate
    (UPDATE `active`), list (SELECT). **No `DELETE`** — deactivate-never-delete, matching `print_agents`
    and the `sync_log`/`sync_cursor` grant discipline (`0001`/`0003`).

Both roles are `NOLOGIN NOSUPERUSER` and inherit to their LOGIN members (default `INHERIT`), which is
how the sync-api pool already reads `sync_log` as a `sync_tailer` member. No new role is introduced.

**An object-privilege GRANT is verified by reading the ACL back, not by trusting the command tag**
(CLAUDE.md §3): the plan's real-PG test asserts `has_table_privilege`/`aclexplode` for each of the
four grants above, in both directions (the role that should hold it does; the role that should not,
does not — e.g. `sync_tailer` must NOT hold `UPDATE (active)`).

## 6. Enrolment core — `packages/sync/src/peers.ts`

Pure verbs on the caller's connection, mirroring `packages/printing/src/agent.ts` but simpler (no
tenant scope, no pairing code, no location). Reuses `hashSecret`/`verifySecret` from `@waitron/identity`
— **no crypto is written here** (the "reuse crypto, write none" rule). The file does
`import "./errors.js"` to keep the `sync.*` codes reachable (the tree-wide reachability guard).

- **`enrolPeer(db, { subscriberId, name }) → { peerId, token }`** — mint
  `randomBytes(32).base64url`, `hashSecret` it, INSERT the row, return `{ peerId: id, token:
  \`${id}.${secret}\` }`. The plaintext leaves the module exactly once, in the return value; it is
  never logged or stored in the clear.
- **`authenticatePeer(db, token) → { subscriberId }`** — the auth CORE, mirroring `authenticateAgent`
  (`agent.ts:183-230`):
  1. split on the **first** `.`; reject a missing separator, empty selector, or empty secret →
     `sync.node_unauthorized`.
  2. UUID-shape-screen the selector before the DB (a non-uuid id against the `uuid` column would raise
     `22P02` → an opaque 500; a forged bearer must stay a clean 401).
  3. `SELECT token_hash FROM sync_peers WHERE id = $sel AND active = true` — the `active` filter is the
     revocation control, so a revoked peer is simply **not found** (instant revoke, no token lifetime).
  4. `verifySecret(secret, row.token_hash)` — constant-time scrypt; never `===`.
  5. gated `last_seen_at` write (skip if already within the last minute — the print-agent pattern), and
     return `{ subscriberId: row.subscriber_id }`.
  Every failure — malformed token, unknown or revoked peer, secret mismatch — folds into the **same**
  `sync.node_unauthorized`, so the response is an oracle for nothing. Runs **directly on the pool**
  (no `withTenant` — `sync_peers` has no RLS), like `recordSubscriberCursor` does.
- **`revokePeer(db, peerId) → { revoked: boolean }`** — `UPDATE sync_peers SET active = false WHERE id
  = $id AND active = true`; `revoked` = a row was affected (so revoking an unknown/already-revoked id
  is a truthful `false`, not an error).
- **`listPeers(db) → PeerSummary[]`** — `id, subscriberId, name, active, lastSeenAt, enrolledAt`,
  ordered by `enrolled_at`. Never returns `token_hash`. Feeds the CLI now and C's dashboard later.

**Error codes:** reuse the existing `sync.node_unauthorized` (params `Record<string, never>`, mapped
to 401 by the sync-api boundary) for every auth failure. It already names the domain concept — *an
unauthorized sync caller* — which is unchanged; only the *mechanism* behind it moved from a shared set
to the registry, and CLAUDE.md §3 says never rename a shipped code. **No new error code is
introduced**: `revokePeer`/`listPeers`/`enrolPeer` return data, and the CLI formats outcomes into exit
codes and lines (the `waitron-sync-evict` shape), so a missing peer is a reported `false`, not a throw.

## 7. The CLI — `waitron-sync-peer`

Follows the `bin-sync-evict.ts` + `sync-evict.ts` split exactly: a thin `apps/server/src/bin-sync-peer.ts`
process wrapper (v8-ignored) over a testable `sync-peer-command.ts` core taking `{ argv, env, connect,
out }`, connecting as `WAITRON_SYNC_RETENTION_DATABASE_URL` (the `sync_retention` member). Subcommands:

- `waitron-sync-peer enrol <subscriberId> <name>` → prints the token **once**, plus a one-line
  reminder that it is shown only now. The operator pastes it into that peer's `WAITRON_SYNC_PEERS`
  entry for this source.
- `waitron-sync-peer revoke <peerId>` → `revoked: true|false`, reported with an exit code.
- `waitron-sync-peer list` → a table of peers (never the hash).

Registered in `apps/server/package.json`'s `bin` map and bundled in its `build` script, beside
`bin-sync-evict`. Wrong/absent args print usage and exit `2`, the evict convention.

## 8. sync-api rewrite — `apps/server/src/sync-api.ts`

- Replace `requireNodeTokens(c, nodeTokens)` with **`requirePeer(db, c) → { subscriberId }`**, which
  extracts `Authorization: Bearer <token>` (the existing parse) and calls `authenticatePeer`. A
  missing/blank header fails closed to `sync.node_unauthorized` **before** any DB work (the existing
  empty-secret posture).
- `/sync-api/hello` and `/sync-api/log` — unchanged behaviour; they simply gate on a valid peer now
  (they do not need the identity, only that the caller is *some* enrolled peer).
- **`/sync-api/cursor`** — the fix. Use the `subscriberId` **returned by `requirePeer`**; **delete the
  body `subscriberId` field entirely.** The body still carries `lane` and `lastAppliedSeq` (screened by
  the existing `laneParam`/`afterSeq` helpers). A peer can now only ever advance **its own** cursor.
- `SyncApiDeps` loses `nodeTokens`; `mountSyncApi` keeps `db` (now also the `authenticatePeer`
  connection — `sync_tailer` holds `SELECT`/`UPDATE(last_seen_at)` on `sync_peers`, so the existing
  pool suffices).

## 9. Config — `apps/server/src/config.ts` + `boot.ts`

- Remove `WAITRON_SYNC_NODE_TOKEN`, the `tokenSet` helper, and the `nodeTokens` field on
  `SyncTransportConfig`. The source authenticates against the table now.
- The **subscriber** side is unchanged: `WAITRON_SYNC_PEERS[].token` is still the token a node presents
  when it pulls (`syncPullOnce` sends `Authorization: Bearer ${peer.token}`, `pull.ts:99`). The only
  change in meaning is that this token must now be one an `enrolPeer` minted on the source it dials —
  no code change on the subscriber, only an operational one.
- `boot.ts` sync wiring drops `nodeTokens` from the `mountSyncApi` deps; nothing else in the boot block
  changes.

## 10. Out of scope (deferred, named so they are not silently dropped)

- **The outbound tunnel (B)** and **cloud read-serving (C)** — separate specs/branches. A is tested
  **LAN-direct**: a peer enrols, then pulls from and reports to a directly-reachable source URL.
- **`dining_tables` FK-closure enrolment** — belongs to C (the first slice that stands up a real
  ordered-lane subscriber); A enrols **no new tables** and changes nothing a peer applies.
- **Multi-tenant / whole-log reader** and the **fiscal hash-chain lane** — later slices (decision 5).

## 11. Testing

- **Real Postgres, not PGlite,** for the grant/role behaviour: PGlite connects every session as a
  superuser, so it cannot show the `sync_tailer`-vs-`sync_retention` split or the column-level grant.
  Auth logic that does not depend on roles may use the lighter target where justified in a comment.
- **The headline regression test proves the forge gap is closed:** peer X's token cannot advance peer
  Y's cursor via `POST /sync-api/cursor`. **Proven by deletion** — drop the "derive `subscriberId`
  from `requirePeer`" line (fall back to the body) and watch the test fail; restore and it passes.
- **Grant read-back tests** (§5): assert each of the four grants by `has_table_privilege`/`aclexplode`,
  including the **negative controls** — `sync_tailer` must NOT hold `UPDATE (active)` or any
  `INSERT`/`DELETE`; `sync_retention` must NOT hold `DELETE`.
- **Auth core tests** mirroring `agent.test.ts`: malformed token, non-uuid selector, unknown peer,
  revoked peer, secret mismatch — all one uniform 401; a valid token returns its `subscriberId`; the
  `last_seen_at` gate writes once then skips within the minute; revoke takes effect on the next call.
- **Rotation test:** two active rows for one `subscriberId`, both tokens authenticate; revoke one, the
  other still works.
- **CLI tests** (the `sync-evict.test.ts` shape): `enrol`/`revoke`/`list` output and exit codes, usage
  on bad args, and the "token printed exactly once" property.
- **Coverage:** `apps/server` and `packages/sync` keep the 98/98/98/95 thresholds; run
  `pnpm --filter <pkg> test:coverage` (CI's shards run coverage, not plain `test`), and the whole
  `@waitron/sync` + `apps/server` suites unfiltered (cross-cutting guards do not load under a
  name-filter).

## 12. Security review

This is a distrusting-peer trust boundary, so a security review is part of the slice (owner note,
2026-08-26). Points it must confirm: identity is derived **only** from the token (no body path
survives); a revoked peer is refused **instantly**; the auth path **cannot** flip `active` (the
column-grant boundary); auth failures leak no oracle (uniform 401, no token in any log line or test
name — the `sync.*` params already forbid row content); and `enrolPeer` never persists or logs the
plaintext token.

## 13. Docs & comments this change retires (CLAUDE.md §3 — editing a file is not auditing it)

The plan must update, not just leave standing: the `nodeTokens` doc on `SyncTransportConfig`
(`config.ts:200-203`) and `loadSyncConfig`'s shared-token paragraph; the `requireNodeTokens` doc and
the `mountSyncApi` header (`sync-api.ts`); the boot sync-wiring comment (`boot.ts:637-643`); the
`WAITRON_SYNC_NODE_TOKEN` rotation language wherever it appears; the backlog "Cloud-mirror peer"
thread; and the `sync-cloud-mirror-peer-identity` memory (record that A is specced/landing). Grep the
whole tree for `WAITRON_SYNC_NODE_TOKEN` and `nodeTokens` before claiming they are gone.

## 14. Provenance

Internal receipts are cited inline as `file:line` against the branch tree. External claims: none —
this slice is entirely internal. The forge-gap trace (§2) and the grant idioms (§5) are read from the
current tree, not from memory; the memories that seeded the design
(`sync-cloud-mirror-peer-identity`, `sync-cloud-mirror-connection-direction`,
`replication-is-shared-infra`) are point-in-time notes and were re-verified against code before use.
