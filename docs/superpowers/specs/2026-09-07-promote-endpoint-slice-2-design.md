# Promote endpoint — Slice 2: authenticated mirror → primary promotion

**Date:** 2026-09-07. **Status:** design — owner decisions taken 2026-09-07 (this session), listed
inline; refined after a fresh-context fiscal review the same day (§4.3 corrected — the earlier draft's
"cert already unlocked" claim was false; see below). **Track B item 3** in `docs/backlog.md`.

**Continues** the promote-action slices: Slice 1 (local secondary → primary, in-process, #160) and
the `singleton_role` foundation (#158) landed; the mirror → primary *mechanism* landed via the
membership R3b arc ([`promoteMirrorToPrimary`](../../../apps/server/src/promote.ts)). This slice
adds the **operator-facing trigger** those in-process functions never got — the network endpoint,
its authorization, and the real DB connection the owner write needs — answering the question the R3b
design ([`2026-09-04-membership-promotion-r3-cloud-promotion-design.md`](2026-09-04-membership-promotion-r3-cloud-promotion-design.md) §8)
left open: *"whether R3b's promote is triggered by the same operator surface as the local promote or
its own."*

**Refines** [`2026-08-29-promotion-runbook-design.md`](2026-08-29-promotion-runbook-design.md) §4.
That design gave the break-glass secret two jobs — *authorize* the promote and *unlock the key ring*
to unseal a **replicated** cert blob so the promoted node could file. This slice keeps only the
authorization job (§4). The unseal job is **deferred with the unbuilt cert-distribution mechanism**
(§4.3), not retired: the fiscal cert is not on the mirror at all today, so a promoted cloud sells but
does not yet file — an explicit, accepted boundary (owner decision 2026-09-07, §4.3). A dated pointer
is added to the 2026-08-29 doc at land (`CLAUDE.md` §6).

---

## 1. Scope

**In.** One authenticated HTTP endpoint that promotes a **mirror to primary**, its two-path
authorization (a manager login, or an offline break-glass secret as fallback), the break-glass
secret mint, and a real runtime admin DB connection for the owner write (replacing the
`migrationsDatabaseUrl` borrow).

**Out** (stays deferred, each its own slice): getting the fiscal cert onto a promoted mirror so it
can **file** (§4.3 — a promoted cloud sells but does not file until this lands); the worker-lifecycle
manager that would avoid the restart (promote-action Slice 3 — this slice restarts, §3); cold-restore
operator surface (Slice 4); rejoin / re-admission (Slice 5); and the two R3 follow-ups
(resume-at-restore marker; re-admission as standby). The `promoteLocalSecondaryToPrimary` function is
**left in the code unwired** — see §2.

## 2. Topology: primary and mirror (the selling secondary is shelved active-active)

The schema carries two axes — `deployment.mode` (`mirror`|`primary`, read-only vs read-write) and
`singleton_role` (`secondary`|`primary`, who holds the submitter/config-writer duties). The only
state that needed both distinctly was **`(primary, secondary)` — a local box that *sells* but holds
no singletons**, which exists only under **active-active**. Active-active was **shelved 2026-09-05**
(warm standby + human promotion; only the primary sells — `docs/backlog.md`, snapshot branch
`shelved/active-active`). So the MVP topology has two live states:

| `deployment.mode` | `singleton_role` | who |
| --- | --- | --- |
| `primary` | `primary` | the one node that sells + holds the singletons |
| `mirror` | `secondary` | the read-only warm standby (cloud today; a post-MVP second local box is also a passive mirror) |

`(primary, secondary)` as a *healthy selling* node does not occur in the MVP. It survives only as a
transient inside `commitMirrorPromotionTx` and as a **fenced** returning ex-primary — read-only, which
wipe-restores back to a mirror and never promotes in place (a fenced returned ex-primary boots
`(primary, secondary)` + fenced, [boot.ts:918-945](../../../apps/server/src/boot.ts#L918)).
**Consequence for this slice:** the failover that happens is **mirror → primary**, so the endpoint
targets only that path and must handle the fenced case explicitly (§3). Wiring
`promoteLocalSecondaryToPrimary` would expose a code path the MVP topology cannot reach (YAGNI); it
stays in the tree under the shelving decision, unexposed. Collapsing the two axes into one `NodeRole`
is a separate item (backlog Track B item 6) — this slice leaves the axes as they are and merely stops
exercising the dead combination.

## 3. The endpoint

`POST /management-api/promote`, following the **server-to-server** pattern of
[`mirror-bundle-api.ts`](../../../apps/server/src/mirror-bundle-api.ts): the operator may be calling
a **remote cloud instance**, so credentials ride in the request **body**, not a cookie.

**Dispatch by the node's own state** — no target parameter (the node knows what it is):

- **mirror `(mirror, secondary)`** → invoke the **boot-wired promote closure** (not
  `promoteMirrorToPrimary` directly): the closure runs `assertFenced` → the abortable pre-PONR steps →
  `commitMirrorPromotionTx` → and, on a real (`!alreadyPrimary`) promotion, triggers the restart
  ([boot.ts:2092-2098](../../../apps/server/src/boot.ts#L2092)). Calling the library function directly
  would skip the restart and leave the flipped node running with no primary-only workers.
- **fenced node `(primary, secondary)` + fenced** → **refuse** with `promotion.node_fenced`, writing
  nothing. A fenced ex-primary returns via wipe-restore, never in-place promotion (§2); the existing
  `assertNotFenced` enforces this inside the promote functions, but the endpoint must reach it —
  see the `alreadyPrimary` correction below.
- **already `(primary, primary)`** → clean `alreadyPrimary` 200 (the operator retried, or two
  operators raced). **Correction from review:** the current `alreadyPrimary` early-return keys on
  `mode === "primary"` alone ([promote.ts:268-272](../../../apps/server/src/promote.ts#L268)), so a
  *fenced* `(primary, secondary)` node would wrongly get `200 {alreadyPrimary}` before `assertNotFenced`
  runs. The endpoint (or the closure it calls) must gate `alreadyPrimary` on `singleton_role ===
  "primary"` too, so the fenced case falls through to the `promotion.node_fenced` refusal, not a lying
  success — a false "already primary" during a disaster is exactly the wrong signal.

**Fence attestation in the body.** `{ oldNodeNeutralised: true }` is passed straight through to the
existing `assertFenced` gate (`promotion.fence_not_attested` if absent). The endpoint does not weaken
the gate — software still cannot verify a partitioned peer, so the human attestation stays required
(2026-08-29 §6).

**Commit, respond, then restart.** Mirror promotion is **restart-into-primary** (R3b §4): the one
owner transaction flips both axes and writes the term-guarded membership document
(`commitMirrorPromotionTx`, the point-of-no-return), the endpoint returns
`200 { alreadyPrimary: false, restarting: true }` (the uniform response body — an already-primary
no-op returns `{ alreadyPrimary: true, restarting: false }`), and the boot-wired closure then triggers
`process.kill(pid, "SIGTERM")`
([boot.ts:2098](../../../apps/server/src/boot.ts#L2098)) → graceful `server.close`, so the supervisor
(systemd / Docker / Waitron Cloud) brings the process back up as `mode = primary`. **Experiment to
run at implementation** (`CLAUDE.md` §1 — the existing test mocks `process.kill`, so it does not prove
this): confirm the 200 body reaches the operator's connection before the process exits; if it cannot
be shown, narrow the response contract (e.g. the operator polls state) rather than asserting the flush.
**Assumption to state at land:** a process supervisor with a restart policy is present (true on the
appliance and on Waitron Cloud; the test harness restarts explicitly).

**Abort semantics (corrected from review).** Auth failure, a missing attestation, and a fenced refusal
all abort with the node **unchanged** (still a read-only mirror). Two nuances the earlier draft
overstated: `persistTradingEnv` rewrites `trading.env` durably **before** the PONR (inert on a
still-read-only mirror by the 2026-09-04 owner decision, but a lasting file write, not "zero effect" —
[promote.ts:185-189](../../../apps/server/src/promote.ts#L185)); and a superseded-term failure is the
**PONR transaction rolling back**, not a pre-PONR abort ([promote.ts:226-233](../../../apps/server/src/promote.ts#L226)).
Net DB state on either failure is unchanged; the file rewrite is the only residue.

## 4. Authorization — two paths (owner decision 2026-09-07: both)

Both paths reach the same endpoint; either one authorizes a single promote call.

### 4.1 Normal: manager login + `node.promote`

Identical to the mirror-bundle flow: body carries `personId` + `password` + optional `totp` →
`loginManagerById` → `authorizeManager(permission: "node.promote")` → `endManagementSession` (the
session exists only to authorize this one call; no cookie is set). A new `node.promote` permission is
added to the permission registry — a domain-concept name (`CLAUDE.md` §3); **grep the sibling
permissions (`mirror.create`, …) for the exact naming and grant shape at implementation.**
**Receipt owed:** confirm on a real adopted mirror that everything `loginManagerById` /
`authorizeManager` reads — the password hash, TOTP secret, and the role→permission mapping — is
actually enrolled/replicated to the mirror (the `persons` row is; the rest is asserted, not verified).

### 4.2 Fallback: an offline break-glass secret

For "the admin login itself is unavailable" — notably a remote cloud instance with no easy shell to
run the existing `waitron-break-glass` CLI reset. (That CLI is a *human-admin password/PIN reset*
gated on physical shell + `DATABASE_URL`; it is not a machine credential and does not apply to a
node the operator cannot get a shell on. This slice's break-glass secret is net-new and distinct.)

- **Mint.** A high-entropy secret (192-bit base64url, via `generatePassword`,
  [`identifiers.ts`](../../../packages/provisioning/src/identifiers.ts)) minted **when a node is
  enrolled as a mirror** (the adopt / connect flow — the enrolment point for the only promotable
  node). It is **shown to the operator exactly once, in the connect-screen response that drives the
  adopt** (a plan detail — pin the surface at implementation; the raw secret must not be logged), to
  store offline; the raw secret is never persisted.
- **Store a verifier, not the secret.** Persist only a **scrypt** hash — via the repo's existing
  `hashSecret` / `verifySecret` helpers ([`packages/identity/src/secret-hash.ts`](../../../packages/identity/src/secret-hash.ts),
  format `scrypt$<salt>$<key>`; the repo deliberately uses scrypt over argon2/bcrypt to avoid a
  native module) — on a new owner-written, app-readable `deployment.break_glass_verifier` column
  (`deployment` is the singleton the promote already owns, a hand-written custom migration —
  [`schema/deployment.ts`](../../../packages/db/src/schema/deployment.ts), not in the drizzle barrel;
  a one-way hash is safe for the app pool to read, and 192-bit entropy makes an offline guess against
  the hash infeasible). Alternative considered: a sealed vault entry — rejected because a verifier
  needs integrity, not confidentiality, and a column keeps it beside the state the promote transaction
  already touches.
- **Verify** with `verifySecret` (constant-time, from the same helper) against the stored verifier.
  Wrong or absent secret → refuse before any state change (error code in the `promotion.*` family,
  e.g. `promotion.break_glass_invalid` — grep siblings at implementation).
- **Rotation.** Re-running the mint overwrites the verifier, invalidating the previous secret; that is
  the rotation story for Slice 2 (a full custody/rotation ceremony stays the 2026-08-29 §9 open item).
  The mint primitive is exposed as a small operator command so a lost secret can be replaced without
  re-adopting.

### 4.3 The fiscal cert is not on the mirror — sell now, file later (owner decision 2026-09-07)

The 2026-08-29 §4 design had break-glass *also* unlock the key ring to unseal a **replicated** cert
blob. **Verified this session (structural read, receipt below): the cert is not on the mirror at
all.** `tenant_credentials` (which holds `fiscal.aeat`) is enrolled on **no sync lane** — no
`enrol()`/`EnrolledTable`, no `sync_capture` trigger in the credentials migrations — and
[`adoptFromPrimary`](../../../apps/server/src/adopt.ts) re-seals only the **sync token** and
establishes the standby's **own node key + reserved SIF**; it never copies or re-seals `fiscal.aeat`.
The cert is sealed under the **box's own** vault key at setup (`sealAeat`, provision-time) and stays
on the box. So on a promoted cloud's first drain tick, `getCredential(..., "fiscal.aeat")` would throw
`credentials.missing`.

- **Decision:** a promoted cloud **sells and chains locally immediately** — trading never blocks on
  filing, there is no filing deadline, and month-end AEAT `consultar` reconciles the tail
  (`CLAUDE.md` §5; the cold-recovery posture). It **does not file** until a separate cert-distribution
  mechanism lands. This is the accepted boundary; the risk is only if it ships *silently*, so it must
  be **explicit** (below).
- **Break-glass in Slice 2 is therefore purely authorization** (§4.2) — it neither unlocks nor
  distributes the cert. The 2026-08-29 unlock job is **deferred with cert-distribution**, not retired
  as obsolete (the earlier draft's framing was wrong: nothing had made the cert usable on the mirror).
- **Make the not-filing state explicit.** On promotion the node logs, and box-status surfaces, that it
  is a primary that cannot yet file (the drain worker's `credentials.missing` is turned into a visible
  "awaiting fiscal certificate" status rather than a silent retry loop). Slice 2's e2e asserts the
  promoted node **sells and chains** and explicitly asserts it does **not** file yet (surfacing the
  awaiting-cert state), so the boundary is pinned by a test, not a comment.
- **Named dependency for filing:** cert distribution to a promoted mirror (re-seal `fiscal.aeat` at
  adopt like the sync token, or ship it in the bundle) — its own slice, adjacent to H2/provisioning.
- **Receipt owed** (the definitive run, `CLAUDE.md` §1 — the above is a structural read): boot a real
  adopted mirror, promote, restart, read the drain log — the failing print without cert-distribution is
  `credentials.missing` for `fiscal.aeat`; the passing assertion is that selling and local chaining
  work and the awaiting-cert state is surfaced. (This is also §8's e2e.)

> **Landed 2026-09-07 — cert-distribution now fills this gap. See
> [`2026-09-07-fiscal-cert-distribution-design.md`](2026-09-07-fiscal-cert-distribution-design.md).**
> The deferred unlock job is built: adopt double-wraps the venue's `fiscal.aeat` cert (vault ring +
> break-glass) into a dormant `fiscal.aeat.dormant` copy, and a break-glass promote re-seals it live
> inside the point-of-no-return transaction, so a promoted standby with the secret now **files** as well
> as sells. Break-glass in Slice 2 was "purely authorization"; from this branch the SAME secret also
> unlocks the cert. A promote without the secret (or with an unusable dormant copy) still sells and
> surfaces the awaiting-cert state, exactly as this section describes.

## 5. The real runtime admin DB connection

Today the owner write borrows `config.migrationsDatabaseUrl` via `withOwnerDb`
([boot.ts:1974-1997](../../../apps/server/src/boot.ts#L1974)), which works only because that URL is
the superuser in dev/CI; on a role-split appliance the true owner of the migrated objects (the **table
owner** — the admin that ran `instance`, which holds `UPDATE` on `deployment` implicitly) is not the
migrator ([`apps/server/README.md`](../../../apps/server/README.md), and the deferral stated in
`boot.ts`).

- Add a config field (e.g. `WAITRON_ADMIN_DATABASE_URL` — **grep siblings for the final name**), read
  as an **env/config value like `migrationsDatabaseUrl`, NOT in `trading.env`** (the promote rewrites
  `trading.env` from a fixed field set and would drop anything else stored there —
  [boot.ts:2076-2087](../../../apps/server/src/boot.ts#L2076)). Value = the connection as the table
  owner, supplied out-of-band by provisioning / Waitron Cloud.
- The promote owner-write uses it via a **short-lived pool** (same transient posture as today's
  `withOwnerDb` — the process connects only while promoting, never holds a standing admin pool).
- **Fall back** to `migrationsDatabaseUrl` (→ `databaseUrl`) when unset, so dev/CI is unchanged and a
  misconfigured appliance fails **closed** with `42501`, never a silent no-op.
- **Scope note (from review):** `withOwnerDb` is also the connection the **boot-time fenced-demote**
  uses ([boot.ts:929](../../../apps/server/src/boot.ts#L929)). Route BOTH through the admin-URL
  fallback (they share `withOwnerDb`), so the "fails closed, never a silent no-op" property holds for
  the whole helper, not just the promote path — otherwise a role-split appliance's fenced boot would
  `42501`. This is pure client-side consumption of a credential provisioning produces; it does not
  build, and does not depend on, Track A's instance role-split.

## 6. Mounting and the read-only-gate hole

- **Mount on both modes.** A mirror (read-only) must be promotable, so the endpoint is mounted
  regardless of `deployment.mode`, unlike the mirror-bundle API (primary-only). Mount it before the
  SPA catch-alls, as the other management-api routes are.
- **Exempt the exact path from the read-only gate**
  ([`read-only-gate.ts`](../../../apps/server/src/read-only-gate.ts)) — the one deliberate hole,
  guarded by §4's auth, **never** the unauthenticated ambient viewer. **Fenced condition (from
  review):** the gate is also mounted for fenced nodes, and the endpoint must not become a
  fenced-node promote path, so the exemption is scoped to the non-fenced mirror case (or the handler
  refuses fenced before doing anything, §3). Pin which at implementation and prove it by deletion (§8).

## 7. Fiscal safety (invariants preserved)

- **At most one primary per NIF.** Unchanged: the `FenceAttestation` gate (§3) plus the
  demote-never-promote membership witness keep the promoted mirror from coexisting with a live
  primary. The endpoint only *conveys* the attestation; it does not relax the guard. **Post-MVP
  note:** the term guard catches a gossip-adopt at ≥ term, but two *different* mirrors (a post-MVP
  second local box) each promoted by a separate human attestation are caught by nothing in software —
  unchanged from R3b, now remotely reachable by a break-glass holder; the human attestation is the
  guard, the fiscal backstop (new chain + disjoint series + AEAT `3000` dedup) is the safety net.
- **New chain on takeover.** Unchanged: `promoteMirrorToPrimary` promotes onto the mirror's own
  reserved SIF (R2/R3a), a distinct chain, never resuming the dead primary's (`CLAUDE.md` §5).
- **`registros_facturacion` immutability** untouched. This slice writes `deployment` +
  `node_membership` + `trading.env` (the promote), plus `deployment.break_glass_verifier` (at mint)
  and a `management_sessions` row per manager-login call — no fiscal record.
- **Auth boundary.** The break-glass verifier is a one-way scrypt hash; the raw secret is never
  persisted and is shown once. The admin DB connection is short-lived and used only for the owner
  write.

## 8. Testing (real Postgres — roles, the read-only gate, the admin connection; `CLAUDE.md` §4)

- **Real-PG e2e through the HTTP endpoint** (not only the in-process call `boot.promote.test.ts`
  covers): a booted mirror is promoted via `POST /management-api/promote`, **restarts**, comes back a
  primary, and **sells + chains locally** — and the test asserts it does **not** file yet, surfacing
  the awaiting-fiscal-certificate state (§4.3). This is the mirror-promote-restart-drain receipt; note
  today's e2e never reboots and spies the SIGTERM, so this is new coverage.
- **Both auth paths:** manager login (right permission) authorizes; the break-glass secret authorizes;
  a wrong/absent credential on either path is refused **before any state change** (assert the node is
  still a read-only mirror after a refused call).
- **The fenced case:** a POST to a fenced `(primary, secondary)` node is refused `promotion.node_fenced`
  (not a lying `alreadyPrimary`), node unchanged (§3).
- **The read-only-gate hole:** the promote POST reaches the handler on a non-fenced mirror while an
  ordinary POST stays blocked. **Prove by deletion:** remove the exemption → the authorized promote is
  blocked; restore, confirm green (`CLAUDE.md` §4).
- **Prove the auth guard by deletion:** remove the auth check → an unauthenticated caller can promote;
  restore.
- **Fence attestation still required** through the endpoint (`promotion.fence_not_attested` without it,
  node unchanged).
- **Break-glass secret handling:** the right secret authorizes; a wrong one is refused; the raw secret
  never appears in the DB (only the scrypt verifier); re-minting invalidates the previous secret.
- **The admin connection:** with `WAITRON_ADMIN_DATABASE_URL` set to a non-owner role the owner write
  fails closed (`42501`), never a silent no-op; unset falls back to the migrations URL.

## 9. Receipts owed, open items, and out of scope

**Receipts owed** (real-PG runs the plan must execute — `CLAUDE.md` §1; §4.3/§8 give the failing/passing prints):
1. Mirror-promote-restart-drain: a promoted cloud sells + chains but does not file, surfacing the
   awaiting-cert state (§4.3, §8) — the definitive run behind the structural read.
2. The manager-login inputs (password hash, TOTP, role→permission mapping) are actually enrolled on the
   mirror, not only the `persons` row (§4.1).
3. `app_user` can read `deployment.break_glass_verifier` but not write it; the owner path sets it —
   confirm the grant shape, don't assume it (§4.2).
4. The 200 response reaches the operator before the restart-exit, or the response contract is narrowed
   (§3).

**Named dependency (separate slice):** cert distribution to a promoted mirror, which gates **filing**
(§4.3) — a promoted cloud sells without it.

**Open (each its own later resolution):** full break-glass custody/rotation ceremony (2026-08-29 §9);
a friendly dashboard promote action (CLI/API-first here — 2026-08-29 §9 item 4); the two-axis →
single-`NodeRole` collapse (backlog Track B item 6).

**Out of scope:** the worker-lifecycle manager (Slice 3); cold-restore surface (Slice 4); rejoin /
re-admission (Slice 5); the R3 follow-ups (resume-at-restore marker; re-admission as standby);
`promoteLocalSecondaryToPrimary`'s trigger (shelved active-active, §2); and cert distribution (above).
