# Promote endpoint — Slice 2: authenticated mirror → primary promotion

**Date:** 2026-09-07. **Status:** design — owner decisions taken 2026-09-07 (this session), listed
inline. **Track B item 3** in `docs/backlog.md`.

**Continues** the promote-action slices: Slice 1 (local secondary → primary, in-process, #160) and
the `singleton_role` foundation (#158) landed; the mirror → primary *mechanism* landed via the
membership R3b arc ([`promoteMirrorToPrimary`](../../../apps/server/src/promote.ts)). This slice
adds the **operator-facing trigger** those in-process functions never got — the network endpoint,
its authorization, and the real DB connection the owner write needs — answering the question the R3b
design ([`2026-09-04-membership-promotion-r3-cloud-promotion-design.md`](2026-09-04-membership-promotion-r3-cloud-promotion-design.md) §8)
left open: *"whether R3b's promote is triggered by the same operator surface as the local promote or
its own."*

**Refines** [`2026-08-29-promotion-runbook-design.md`](2026-08-29-promotion-runbook-design.md) §4.
That design specified one break-glass secret that both *authorized* the promote **and** *unlocked
the key ring* to unseal the fiscal cert. The architecture has since moved — the vault is unlocked at
boot from the deployment's own `WAITRON_CREDENTIALS_KEY` — so break-glass's key-ring-unlock role is
retired here (§4.3); a dated pointer is added to the 2026-08-29 doc at land (`CLAUDE.md` §6).

---

## 1. Scope

**In.** One authenticated HTTP endpoint that promotes a **mirror to primary**, its two-path
authorization (a manager login, or an offline break-glass secret as fallback), the break-glass
secret mint, and a real runtime admin DB connection for the owner write (replacing the
`migrationsDatabaseUrl` borrow).

**Out** (stays deferred, each its own slice): the worker-lifecycle manager that would avoid the
restart (promote-action Slice 3 — this slice restarts, §3); cold-restore operator surface (Slice 4);
rejoin / re-admission (Slice 5); and the two R3 follow-ups (resume-at-restore marker; re-admission
as standby). The `promoteLocalSecondaryToPrimary` function is **left in the code unwired** — see §2.

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
transient inside `commitMirrorPromotionTx` and as a **fenced** returning ex-primary (read-only, which
wipe-restores back to a mirror and never promotes in place — `assertNotFenced`,
[`promote.ts`](../../../apps/server/src/promote.ts)). **Consequence for this slice:** the failover
that happens is **mirror → primary**, so the endpoint targets only that path. Wiring
`promoteLocalSecondaryToPrimary` would expose a code path the MVP topology cannot reach (YAGNI); it
stays in the tree under the shelving decision, unexposed. Collapsing the two axes into one
`NodeRole` is a separate item (backlog Track B item 6) — this slice leaves the axes as they are and
merely stops exercising the dead combination.

## 3. The endpoint

`POST /management-api/promote`, following the **server-to-server** pattern of
[`mirror-bundle-api.ts`](../../../apps/server/src/mirror-bundle-api.ts): the operator may be calling
a **remote cloud instance**, so credentials ride in the request **body**, not a cookie.

- **One target: mirror → primary.** On a mirror the endpoint invokes the existing
  `promoteMirrorToPrimary`; on a node already `(primary, primary)` it returns a clean `alreadyPrimary`
  200 (idempotent — the operator retried, or two operators raced). No target parameter and no
  dispatch branch: the node knows its own state, and the only promotable state is `mirror`.
- **Fence attestation in the body.** `{ oldNodeNeutralised: true }` is passed straight through to the
  existing `assertFenced` gate (`promotion.fence_not_attested` if absent). The endpoint does not
  weaken the gate — software still cannot verify a partitioned peer, so the human attestation stays
  required (2026-08-29 §6).
- **Commit, respond, then restart.** Mirror promotion is **restart-into-primary** (R3b §4): the one
  owner transaction flips both axes and writes the term-guarded membership document
  (`commitMirrorPromotionTx`, the point-of-no-return), the endpoint returns `200 {restarting: true}`
  **after the response is flushed**, then the process exits so its supervisor (systemd / Docker /
  Waitron Cloud) brings it back up as `mode = primary` — where boot starts the primary-only workers
  on the identity the mirror already held (R3b §4, "on reboot"). The mirror is not selling, so the
  brief restart costs nothing. Promote-action Slice 3 later removes the restart with an in-process
  worker manager; this slice depends on it, exactly as the R3b design and the
  `boot.promote.test.ts` mirror e2e already do. **Assumption to state at land:** a process supervisor
  with a restart policy is present (true on the appliance and on Waitron Cloud; the test harness
  restarts explicitly).
- **Everything before the PONR is abortable with zero effect** (auth failure, missing attestation, a
  superseded term) — the node stays a read-only mirror (2026-08-29 §7).

## 4. Authorization — two paths (owner decision 2026-09-07: both)

Both paths reach the same endpoint; either one authorizes a single promote call.

### 4.1 Normal: manager login + `node.promote`

Identical to the mirror-bundle flow: body carries `personId` + `password` + optional `totp` →
`loginManagerById` → `authorizeManager(permission: "node.promote")` → `endManagementSession` (the
session exists only to authorize this one call; no cookie is set). This works remotely and in the
disaster case because the `persons`/permission rows are replicated to the mirror. A new `node.promote`
permission is added to the permission registry — a domain-concept name (`CLAUDE.md` §3); **grep the
sibling permissions (`mirror.create`, …) for the exact naming and grant shape at implementation.**

### 4.2 Fallback: an offline break-glass secret

For "the admin login itself is unavailable" — notably a remote cloud instance with no easy shell to
run the existing `waitron-break-glass` CLI reset. (That CLI is a *human-admin password/PIN reset*
gated on physical shell + `DATABASE_URL`; it is not a machine credential and does not apply to a
node the operator cannot get a shell on. This slice's break-glass secret is net-new and distinct.)

- **Mint.** A high-entropy secret (192-bit base64url, via `generatePassword`,
  [`identifiers.ts`](../../../packages/provisioning/src/identifiers.ts)) minted **when a node is
  enrolled as a mirror** (the adopt / connect flow — the enrolment point for the only promotable
  node). It is **shown to the operator exactly once** to store offline; the raw secret is never
  persisted.
- **Store a verifier, not the secret.** Persist only a KDF hash on a new owner-written,
  app-readable `deployment.break_glass_verifier` column (`deployment` is the singleton the promote
  already owns; a one-way hash is safe for the app pool to read, and 192-bit entropy makes an offline
  guess against the hash infeasible regardless of the KDF's cost). Alternative considered: a sealed
  vault entry — rejected because a verifier needs no confidentiality, only integrity, and a column
  keeps it beside the state the promote transaction already touches.
- **Verify** with a constant-time compare of the presented secret's KDF hash against the stored
  verifier. Wrong or absent secret → refuse before any state change (error code in the `promotion.*`
  family, e.g. `promotion.break_glass_invalid` — grep siblings at implementation).
- **Rotation.** Re-running the mint overwrites the verifier, invalidating the previous secret; this
  is the rotation story for Slice 2 (a full custody/rotation ceremony stays the 2026-08-29 §9 open
  item). The mint primitive is exposed as a small operator command so a lost secret can be replaced
  without re-adopting.

### 4.3 Retiring break-glass's key-ring-unlock role

The 2026-08-29 §4 design had the break-glass secret **also unlock the key ring** to unseal the
fiscal cert, so a passive mirror could not file until an operator showed up — deliberately keeping
the cert's standing exposure low. The current architecture already unlocks the vault at boot from the
deployment's own `WAITRON_CREDENTIALS_KEY` ([boot.ts](../../../apps/server/src/boot.ts), the
`loadKeyRing`/`ensureBoxSecrets` path), and the fiscal cert (`fiscal.aeat`) lives in that vault, so a
running mirror already holds an unlocked cert. Break-glass's unlock role is therefore **obsolete**;
in this slice break-glass is **purely authorization**. A dated pointer is added to the 2026-08-29 doc
at land. **Receipt owed** (`CLAUDE.md` §1 — verify, don't assert): on a real mirror DB, confirm the
KeyRing/`fiscal.aeat` is usable at boot without any operator secret (the standing-exposure trade-off
this records is a consequence of the R3a "own sealed identity, decryptable by the app pool" posture,
already flagged for Slice 5's threat model, #203 follow-up (c)).

## 5. The real runtime admin DB connection

Today the owner write borrows `config.migrationsDatabaseUrl` via `withOwnerDb`
([boot.ts](../../../apps/server/src/boot.ts)), which works only because that URL is the superuser in
dev/CI; on a role-split appliance the true owner of the migrated objects (including `UPDATE` on
`deployment`) is the admin that ran `instance`, not the migrator
([`apps/server/README.md`](../../../apps/server/README.md), and the deferral stated in `boot.ts`).

- Add a config field (e.g. `WAITRON_ADMIN_DATABASE_URL` — **grep siblings for the final name**) = the
  connection as that owning admin, supplied out-of-band by provisioning / Waitron Cloud.
- The promote owner-write uses it via a **short-lived pool** (same transient posture as today's
  `withOwnerDb` — the process connects only while promoting, never holds a standing admin pool).
- **Fall back** to `migrationsDatabaseUrl` (→ `databaseUrl`) when unset, so dev/CI is unchanged and a
  misconfigured appliance fails **closed** with `42501`, never a silent no-op.
- This is **pure client-side consumption of a credential provisioning produces** — it does not build,
  and does not depend on, Track A's instance role-split.

## 6. Mounting and the read-only-gate hole

- **Mount on both modes.** A mirror (read-only) must be promotable, so the endpoint is mounted
  regardless of `deployment.mode`, unlike the mirror-bundle API (primary-only). Mount it before the
  SPA catch-alls, as the other management-api routes are.
- **Exempt the exact path from the read-only gate.** The gate
  ([`read-only-gate.ts`](../../../apps/server/src/read-only-gate.ts)) blocks every non-GET on a
  mirror; the promote endpoint is the **one deliberate hole**, guarded by §4's auth, **never** the
  unauthenticated ambient viewer. On a successful mirror promotion the restart (not the ambient
  teardown) brings the node up writable; the exemption is what lets the authorized POST reach the
  handler in the first place.

## 7. Fiscal safety (invariants preserved)

- **At most one primary per NIF.** Unchanged: the `FenceAttestation` gate (§3) plus the
  demote-never-promote membership witness keep the promoted mirror from coexisting with a live
  primary. The endpoint only *conveys* the attestation; it does not relax the guard.
- **New chain on takeover.** Unchanged: `promoteMirrorToPrimary` promotes onto the mirror's own
  reserved SIF (R2/R3a), a distinct chain, never resuming the dead primary's (`CLAUDE.md` §5). This
  slice writes no fiscal record — it writes `deployment` + `node_membership` + `trading.env` only.
- **`registros_facturacion` immutability** untouched.
- **Auth boundary.** The break-glass verifier is a one-way hash; the raw secret is never persisted and
  is shown once. The admin DB connection is short-lived and used only for the owner write.

## 8. Testing (real Postgres — roles, the read-only gate, the admin connection; `CLAUDE.md` §4)

- **Real-PG e2e through the HTTP endpoint** (not only the in-process call already covered by
  `boot.promote.test.ts`): a booted mirror is promoted via `POST /management-api/promote` and comes
  back a primary that files on its own reserved SIF.
- **Both auth paths:** manager login (right permission) authorizes; the break-glass secret authorizes;
  a wrong/absent credential on both paths is refused **before any state change** (assert the node is
  still a read-only mirror after a refused call).
- **The read-only-gate hole:** the promote POST reaches the handler on a mirror while an ordinary POST
  is still blocked. **Prove by deletion:** remove the path exemption → the authorized promote is
  blocked by the gate; restore, confirm green (`CLAUDE.md` §4).
- **Prove the auth guard by deletion:** remove the auth check → an unauthenticated caller can promote;
  restore.
- **Fence attestation still required** through the endpoint (`promotion.fence_not_attested` without
  it, node unchanged).
- **Break-glass secret handling:** the right secret authorizes; a wrong one is refused; the raw secret
  never appears in the DB (only the verifier); re-minting invalidates the previous secret.
- **The admin connection:** with `WAITRON_ADMIN_DATABASE_URL` set to a non-owner role the owner write
  fails closed (`42501`), never a silent no-op; unset falls back to the migrations URL.

## 9. Receipts owed, open items, and out of scope

**Receipts owed before implementation relies on them** (real-PG checks the plan must run —
`CLAUDE.md` §1):
1. The KeyRing / `fiscal.aeat` cert is usable at boot on a mirror with no operator secret (§4.3).
2. `app_user` can read the `deployment.break_glass_verifier` column (for verification) but not write
   it; the owner write path sets it — confirm the grant shape, don't assume it.

**Open (each its own later resolution, not this slice):** full break-glass custody/rotation ceremony
(2026-08-29 §9); a friendly dashboard promote action (CLI/API-first here — 2026-08-29 §9 item 4); the
two-axis → single-`NodeRole` collapse (backlog Track B item 6).

**Out of scope:** the worker-lifecycle manager (Slice 3); cold-restore surface (Slice 4); rejoin /
re-admission (Slice 5); the R3 follow-ups (resume-at-restore marker; re-admission as standby); and
`promoteLocalSecondaryToPrimary`'s trigger (shelved active-active, §2).
