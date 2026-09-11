# On-node print-agent auto-enrolment

**Date:** 2026-09-11
**Status:** design, pre-implementation
**Amends:** [`2026-09-08-device-join-and-accept-design.md`](2026-09-08-device-join-and-accept-design.md)
— adds a third way in beside pairing-mode knock-and-accept, for a joiner that is a process running on
a node. The knock-and-accept path is unchanged; a device (a till, a Pi) still joins exactly as it does
today.

---

## 0. What this adds, and why

Enrolment today is one mechanism for every joiner: the admin opens a fifteen-minute pairing window, the
joiner knocks carrying a name, it shows a two-digit number, and the admin taps the matching number in
the dashboard. Two deliberate human acts stand in for a shared secret.

That ceremony is exactly right for a device someone carries in — a till, a handheld, a Raspberry Pi next
to a printer — where a human vouching for the number is what establishes trust. It is exactly wrong for a
print agent running **on a node** — the primary box itself, or a mirror box. That agent is already inside
the node's trust boundary: it runs on the same host, under the same filesystem, and can already read the
box's secrets. Making a human match a number for it — against two decoys, live on the box — is ceremony
for a trust decision that is already settled by where the process runs.

Measured cost, 2026-09-10 (PR #308, the box-wiring live test): the box's own print agent had to be
Accepted by a human matching its number in the dashboard, on the same box that had just been installed.
That is the friction this removes.

**The rule, from the owner:** a print agent running on a node enrols itself silently — no window, no
number, no human. A print agent on a separate device keeps knock-and-accept exactly as it is.

### 0.1 Scope of THIS branch: the primary box only

The rule names "primary or mirror". This branch builds the **primary-box** half and defers the mirror
half, because the mirror half turns out to be much larger than a trust decision — see §7. The two halves
share one route and one agent behaviour; the mirror slots into them later without reshaping either.

What ships here: the primary box's own print agent enrols itself at install, silently. A mirror box's
agent continues to do what it does today (which is nothing — §7.1), until the follow-up lands.

---

## 1. The mechanism (primary box)

### 1.1 The loopback self-enrol route

A new route, mounted beside the existing public node probe (`GET /api/node`, `node-api.ts`):

```text
POST /api/node/enrol-self      (loopback-only, unauthenticated)
```

Its contract is two checks and a write:

1. **The caller reached us over loopback.** If the connection's remote address is not loopback
   (`127.0.0.1` / `::1` / `::ffff:127.0.0.1`), refuse with `node.enrol_not_local`. This is the whole
   trust gate, and it is sufficient: anything that can reach a box's loopback interface can already read
   that box's vault, so enrolling a loopback caller grants it nothing it could not already take. Loopback
   is not a weak stand-in for authentication here — it *is* the boundary.
2. **This node is the primary.** Only the primary can write `print_agents` (a mirror's database is a
   read-only replication subscriber, §7.1). If this node is not the primary, refuse with
   `node.enrol_unavailable`. The primary predicate is the one boot already computes for "am I accepting
   sales" (the plan pins the exact signal; deployment mode `primary` and `acceptingSales` agree on a
   booted primary).
3. **Enrol, keyed to this node.** Upsert one `print_agent` row for this node's id (§3): mint a fresh
   bearer token, return `{ token }` in the body. No pairing window is consulted and no verification
   number is minted — there is no human in this path to read one.

The route takes a name for the agent's label, the same field the knock takes.

### 1.2 Why no signature here

The join-and-accept spec's numeric match, and the vouch this design's mirror follow-up will add, both
exist to carry trust across a gap — a room, or the LAN. On the primary box there is no gap: the caller is
on the host **and** the host is the writer. Loopback answers "are you on this box"; being the primary
answers "can I record you". Nothing has to cross anything, so nothing has to be signed. The mirror case,
where the write must happen on a *different* box than the one the agent sits on, is the only place a
signature earns its keep (§7).

---

## 2. How the agent decides which path to take

The agent must not be *told* whether it is on a node or on a device — a box can be repurposed, and a
setting someone forgets to flip is a support call. It finds out by asking, every time it needs to enrol.

On a tick where the agent holds no token:

1. **Ask its own loopback for self-enrol** — `POST https://127.0.0.1/api/node/enrol-self`, a **fixed,
   literal loopback address**, not the agent's configured server URL. (A till's configured URL is the
   primary's LAN address a human typed; this probe is always `127.0.0.1`.)
2. **It returns a token** → the agent is on the primary box. Store the token, done. It never knocks,
   never shows a number, never polls for approval.
3. **It refuses, or nothing answers** → the agent is on a device (a till, a Pi), or on a box that is not
   the primary. Fall back to **exactly today's behaviour**: knock at the configured server, show the
   two-digit number, report `pairing_closed` while the window is shut, wait for a human accept.

This falls out correctly with no per-box configuration:

- **Primary box.** A Waitron server is on `127.0.0.1`, it is the primary, and the agent already trusts
  its CA (it pinned `http://127.0.0.1/ca.crt` at startup, `server-ca.ts`). Self-enrol succeeds.
- **Till / Pi.** Nothing is listening on the device's own `127.0.0.1:443`; the connection is refused; the
  agent takes the manual path. A human typed the primary's address and a human accepts the agent —
  unchanged.
- **Mirror box (today).** A server *is* on `127.0.0.1`, but it is a standby, so self-enrol refuses with
  `node.enrol_unavailable`. The agent falls back to the manual path, which on a mirror box has no
  configured primary address to knock at, so it idles (§7.1). This is the case the follow-up fixes.

Two properties make the fallback trustworthy rather than accidental:

- **A failed self-enrol is never read as permission.** Refused, timed out, TLS-rejected — every non-token
  answer takes the manual path. The direction of failure is chosen: a broken loopback read enrols nobody
  automatically; it makes everyone fall back to the human accept we already ship.
- **CA pinning defends the device case.** Something squatting on a device's `127.0.0.1:443` cannot present
  a certificate the agent's pinned CA signed, so the TLS handshake fails and the agent falls back. A
  squatter cannot manufacture a self-enrol success.

---

## 3. The agent record learns its node

`print_agents` gains a nullable `node_id`, unique per tenant among non-null values.

- **NULL** — a human enrolled this agent through knock-and-accept (a till, a Pi). NULLs do not collide
  with each other (Postgres treats them as distinct in a UNIQUE index), so manual agents are unconstrained,
  exactly as today.
- **Set** — this node enrolled itself. At most one such row per node per tenant.

**No foreign key to `nodes`.** The reason matters and goes in the migration's commit: the primary
provably holds no `nodes` row for a mirror — when a mirror joins, the primary signs an endorsement over
the mirror's key and stores *nothing* (`mirror-bundle.ts` endorses; `reserved-identity.ts` keeps the row
on the mirror's own database). A foreign key would reject precisely the mirror self-enrol the follow-up
exists to serve. A bare `node_id` column without a key is the §1-of-CLAUDE.md "state the reason" case; the
reason is this paragraph.

**Self-enrol is idempotent per node — it refreshes, never duplicates.** An on-node agent re-asks whenever
it has lost its token: its token lives on a named volume that a reinstall or a wipe can clear. On a
re-ask, the primary finds the existing row for this node and mints it a fresh token (overwriting
`token_hash`), rather than inserting a second row. Consequences:

- No pile-up of dead on-node agents across reinstalls.
- The agent's printer bindings (`printers.agent_id` → this row) survive a reinstall, because the row's id
  is stable across re-enrols.

---

## 4. Revoke gains a way back — closing the trap

Revoke today is a one-way door: `POST /management-api/print-agents/:id/revoke` sets `active = false`
(`print-api.ts`), and nothing sets it true again. That was survivable while re-enrol was the recovery
path. It stops being survivable the moment an on-node agent **refuses to auto-re-enrol while revoked**,
which is the behaviour the owner asked for (a deliberate revoke must stick, or "off" means nothing).

Without a way back, an accidental revoke of the box's own agent would permanently kill printing on that
box, with the normal recovery — re-enrol — deliberately blocked. So this branch adds:

- **An "allow again" management action** beside the existing two-step revoke: `active := true`, gated on
  `printer.manage`, behind its own confirm. This is the recovery for a revoked on-node agent.
- **Self-enrol respects a sticking revoke.** If the node's existing row is `active = false`, self-enrol
  refuses with `device.join_revoked` rather than flipping it back — the agent stays out until an admin
  allows it again. The agent reports this as a distinct, terminal-until-restarted state, the way it
  already treats `not_approved`.

Shipping the sticking revoke without the "allow again" action would be shipping a trap; they land
together.

---

## 5. The admin sees provenance

The agents management list (`GET /management-api/print-agents`, rendered by
`apps/dashboard/src/screens/printers-screen.ts`) shows, per agent, whether it enrolled itself and on which
node. An agent that appeared with nobody accepting a number is otherwise a mystery on the list; the
provenance column is what makes a silently-enrolled agent legible rather than alarming.

The list still never returns a verification number (join-and-accept §1.2 rule 1); self-enrol has none to
leak.

---

## 6. Error codes

Named into the families that already own these concepts, never a new family (CLAUDE.md §3):

- `node.enrol_not_local` — `POST /api/node/enrol-self` reached from a non-loopback address. `node.*` is
  facts about this node/process (`node-api.ts` siblings).
- `node.enrol_unavailable` — this node cannot self-enrol an agent: it is not the primary. The mirror-today
  case, and the follow-up's "not adopted yet" case.
- `device.join_revoked` — the node's own agent row is revoked; self-enrol refuses until an admin allows it
  back. `device.*` already owns the cross-surface join vocabulary (`device.pairing_closed` is thrown by
  the print API too).

The knock-and-accept codes (`device.pairing_closed`, `device.join_full`, `device.join_rate_limited`,
`device.join_mismatch`) are untouched — that path does not change.

The flood rate-limiter still guards `/api/node/enrol-self` (the same `createEnrolRateLimiter` the knock
uses), before the loopback check touches anything, so an unauthenticated flood on this route draws no
connection from the pool.

---

## 7. The mirror follow-up (designed, not built here)

This section records the mirror half so the follow-up is a slot-in, not a redesign, and so the deferral is
an explicit decision rather than a silent gap.

### 7.1 Why the mirror is a separate, larger job

Two facts, both verified against the code, make the mirror case bigger than a trust decision:

1. **A mirror cannot write its own agent record.** A mirror's database is a read-only replication
   subscriber; `print_agents` is `state`-classified and replicates *down* from the primary
   (`packages/db/src/classification.ts`). So a mirror-box agent's record must be written on the *primary*,
   which means the enrolment must reach the primary — the agent cannot be served locally the way the
   primary-box agent is.
2. **A mirror agent cannot reach the primary over TLS today, and needs to at runtime regardless.** The
   agent pins only the CA its *local* box serves (`server-ca.ts` trusts `[...rootCertificates,
   localBoxCa]`). The primary presents a certificate signed by the *primary's* CA, which the mirror agent
   does not trust — the handshake fails. This is not only an enrolment problem: at runtime the agent pulls
   jobs *directly* from the primary, so a working mirror-box agent must trust the primary's CA to function
   at all. Adopt already carries the primary's CA to the mirror, but into `mirror_config.boxCaPem` for the
   mirror *server's* outbound use (`adopt.ts`) — the mirror keeps serving its own CA, and the agent never
   sees the primary's.

So "auto-enrol a mirror's agent" cannot land without first making a mirror's agent able to reach the
primary — which is "make the print-agent work on a mirror end-to-end", a capability nothing exercises
today (a mirror agent currently has no way even to learn the primary's address — §7.2 — so it idles).
That is a materially bigger branch, with box-level cross-CA TLS testing, and it is the owner's call to
take it separately (owner decision, 2026-09-11). The deli that hit the original friction is single-box; the
primary-box half delivers that value on its own.

### 7.2 What the follow-up adds (the vouch)

When the write must happen on a different box than the agent sits on, loopback no longer proves anything to
the primary — the knock crosses the LAN. The follow-up restores that proof with a **vouch**: a short signed
statement the mirror's local server issues over loopback, which the agent carries to the primary.

- **`POST /api/node/enrol-self` on a standby returns a vouch instead of a token.** The body:
  `{ nodeId, kind, nonce, expires }` (a 60-second expiry), signed with the node's Ed25519 identity key via
  `signBytes`, plus the node's endorsement (the certificate the primary signed for it at adopt). The
  response also carries what the agent needs to reach the primary: the venue's routable servers
  (`routableServers(held)`, primary first — the same list the job-pull already sends) **and the primary's
  CA**, so the agent can learn *and trust* the primary's endpoint. The multi-CA trust (the agent pinning
  more than one box's CA) is the new capability in `server-ca.ts`.
- **The knock carries the vouch.** `POST /print-api/agent/join` learns one optional field. With no vouch,
  today's behaviour is unchanged. With a valid vouch the primary checks four things — the signature
  verifies, `resolveSignerKey` walks the endorsement back to a trusted root, the expiry has not passed,
  and the `nonce` has not been spent — and on all four enrols the agent on the spot, keyed to the vouch's
  `nodeId`, with no window and no human. The spent-nonce set lives in memory on the primary beside the
  pairing window and the rate limiter; a restart forgets it, at worst letting a 60-second-old vouch be
  used twice, which the alternative (a replicated table for a value that expires in a minute) does not
  justify.
- **The dormant key is used before promotion.** A standby's Ed25519 key was designed as a dormant identity,
  inert until promotion. Signing a vouch uses it earlier. It mints nothing — no fiscal record, no
  membership document, no invoice number — it only proves the box belongs to the cluster. Owner approved
  this widening of "dormant", 2026-09-11.
- **`kind` makes it reusable.** A future on-node joiner that is not a print agent (a USB POS driver, say)
  enrols by the same route and the same vouch with its own `kind`, without reshaping any of this. The
  generic seam is the route and the agent's "ask loopback to enrol me" behaviour, both of which ship in
  this branch; the vouch is the part the follow-up fills in.

- **On promotion, nothing duplicates.** The agent's row was written on the primary keyed to the mirror's
  node, and it replicates *to* the mirror. When the mirror is promoted the row is already in its database
  and the agent's stored token keeps working — it stops routing over the LAN and starts talking to itself.
  Keying the row to the node (§3) is what closes this.

---

## 8. Dev mode

Dev mode holds pairing open and auto-accepts a knock (join-and-accept §8), so a dev till boots straight
in. The dev stack runs the print agent on the same box as the server (`deploy/compose.yml` and the dev
equivalent), so in dev the agent is on the primary and takes the self-enrol path — it enrols with no
window and no auto-accept ceremony at all, which is strictly simpler than the knock path dev mode
short-circuits. No dev-specific code is needed for self-enrol; the loopback-and-primary checks hold in dev
exactly as in production.

---

## 9. Testing

Unit and real-Postgres coverage:

- **The loopback gate, proven by deletion.** Remove the loopback check and a non-loopback caller succeeds
  — record the RED/GREEN. A negative control from a non-loopback address must be refused with
  `node.enrol_not_local` for the reason claimed, not incidentally.
- **The primary predicate.** A standby refuses self-enrol with `node.enrol_unavailable`; a primary
  succeeds. Real Postgres, because the write and the role matter.
- **Idempotency (real Postgres).** Two self-enrols from the same node produce one row with a refreshed
  token, not two rows; the row id is stable so a bound printer stays bound.
- **The sticking revoke and the way back.** A revoked node's self-enrol is refused with
  `device.join_revoked`; "allow again" restores it; a subsequent self-enrol succeeds.
- **The agent's node-vs-device decision.** Self-enrol returns a token → the agent stores it and never
  knocks; self-enrol refused/unreachable → the agent knocks exactly as today. Exercised over the agent
  loop, with the loopback fetch stubbed both ways.

The one thing that must be **measured on the real box, not reasoned about** (CLAUDE.md §1, "reading is not
verification"):

- **Does the server actually see `127.0.0.1` as the caller's remote address**, under `network_mode: host`
  and behind TLS, for the on-box agent — and a *different* address for a LAN caller? Nothing in this
  codebase reads a peer address today, so there is no precedent to lean on. The probe needs a control in
  the other direction: a knock from the LAN must read as a non-loopback address, or a reading where both
  look alike proves nothing (CLAUDE.md §1, "a measurement taken where both answers look alike measures
  nothing"). If the address cannot be read reliably, the route **refuses** (fails to the manual path we
  already ship), and self-enrol is held until the reading is trustworthy.

---

## 10. Out of scope

- **The mirror half** (§7) — deferred by owner decision to a follow-up gated on cross-box print-agent TLS.
- **Devices (tills, Pis) auto-enrolling** — the knock-and-accept path is deliberately unchanged; only a
  print agent gains self-enrol, and only on a node.
- **Any change to the pairing window, the numeric match, or the decoy rules** of the join-and-accept
  design — untouched.
</content>
</invoke>
