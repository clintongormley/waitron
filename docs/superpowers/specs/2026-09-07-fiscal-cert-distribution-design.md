# Fiscal certificate distribution to a promoted node — design

Date: 2026-09-07 (revised same day after a fresh-context fiscal review — see §10 for what the review
changed). Track B item 3 follow-up ("cert distribution to a promoted mirror" — the named dependency
that unblocks _filing_ on a promoted cloud, `docs/backlog.md` Track B item 3 "STILL OWED").
Supersedes the "unlock the key ring" framing of `2026-08-29-promotion-runbook-design.md` §4–5 (§9).

Single slice (owner decision 2026-09-07: "do both in one"). Two coupled halves answer one question —
_where does the key that opens the AEAT certificate live, on each kind of node_ — plus the operator
surface and the missing renewal path that fall out of them. One disaster-recovery sub-path
(restoring an on-prem backup onto a cloud node) is **split to a fast-follow** (§4.3).

---

## 1. The problem, and the invariant that shapes the fix

A cloud **mirror** that is promoted to primary sells and chains on its own reserved SIF but **cannot
file** with AEAT, because it does not hold the venue's AEAT certificate. Today that is honest and
loud — `awaitingFiscalCertificate` on box-status, "sell now, file later" (#272) — but it is a dead
end: nothing can ever put the certificate on the promoted node.

Structural state today (verified by structural read this session; receipts inline):

- The certificate is a vault row `tenant_credentials(tenant_id, "fiscal.aeat")` holding
  `{ pfxBase64, passphrase, certKind }`, sealed AES-256-GCM with AAD `(tenantId, purpose)`
  (`packages/credentials/src/purposes.ts:29`, `.../cipher.ts:23-35`), under a **random 32-byte key**
  the node mints for itself at first boot into `<stateDir>/secrets.env` (0600)
  (`apps/server/src/box-secrets.ts:134-144`).
- A cloud node mints its **own, different** key the same way, so a row sealed under one node's key is
  undecryptable on any other (GCM auth fails) — `purposes.ts:35-36` states this. Nothing copies the
  certificate: the adopt bundle carries the sync token in plaintext (re-sealed mirror-side) but
  **deliberately not** the certificate (`apps/server/src/mirror-bundle.ts:60-75`,
  `apps/server/src/adopt.ts:106-214`).
- The drain reads only `fiscal.aeat`; a **missing** row makes it **skip that tenant** — no throw, no
  stall — and flips the shared `AwaitingCertStatus` cell (`packages/fiscal-verifactu/src/drain.ts:193-206`,
  `apps/server/src/pass.ts:74-131`). Note the asymmetry the design must respect: a **present but
  undecryptable** row throws `credentials.decrypt_failed` (`store.ts:41-43`), which `pass.ts:81`
  does **not** match — so it would NOT flip the awaiting cell. This is why the certificate must never
  arrive on a node that cannot open it (§2.4).
- There is **no primitive in the repo** to wrap a secret to another node's public key (Ed25519 is
  signature-only; no X25519/HPKE/sodium anywhere). The only envelope that exists is
  passphrase-derived scrypt + AES-256-GCM (`apps/server/src/recovery-bundle.ts:38-64`, scrypt in
  `apps/server/src/scrypt-kdf.ts`).
- There is **no endpoint to install or replace a certificate** after setup
  (`apps/server/src/setup-api.ts:424` is the only seal site) — so certificate renewal (every few
  years) has no path today either, independent of failover.

**The hard ceiling (stated plainly).** A node that files unattended must open its certificate with no
human present at boot — the drain retries hourly. So the _running process_ can always open the
certificate; we cannot defend against a live compromise of that specific process (root on the box,
memory access) short of hardware-backed TLS keys, which undici/mTLS cannot drive. What this design
_does_ guarantee is that the certificate is openable **only inside the running process** — never from
a disk image, a database dump, a snapshot, or a backup artifact taken from that node. Everything
bulk-stealable stops yielding a usable certificate; only a live process compromise does. That is the
standard posture for unattended services holding signing material (envelope encryption + externally
held key), and it is the same rule on every node kind:

| Node kind | What guards the key that opens the certificate |
| --- | --- |
| On-prem box | the disk itself (full-disk encryption, TPM-sealed auto-unlock) — an OS-image concern, decided in `2026-08-26-appliance-onboarding-design.md` §9; **no code here** |
| Cloud node (primary or standby) | Waitron Cloud's secrets service holds the vault key; the instance proves a machine identity to fetch it at boot (§4). The disk holds only ciphertext |
| Cloud standby, pre-promotion | additionally wrapped under the operator's **break-glass secret**, which is on no node at all (§2–3) |

The two halves of this slice are §2–3 (the standby's dormant copy and its unlock/install paths) and
§4 (cloud nodes take the vault key from the environment; backups carry no key). §5–8 are the
operator surface, the registry/permission/vocabulary deltas, testing, and scope.

---

## 2. The dormant copy — established at adopt

The standby receives the certificate at adopt, wrapped so **nothing on the cloud instance can open
it** until the operator presents the break-glass secret at promotion. This mirrors the reserved SIF:
the full dormant identity is seeded at join and activated on promotion (`reserved-sif-seeded-at-join`).

### 2.1 The bundle carries the plaintext certificate

`MirrorBundle` (`apps/server/src/mirror-bundle.ts:60-75`) gains one optional field:

```ts
aeatCert?: { pfxBase64: string; passphrase: string; certKind: CertKind }
```

- Present only when the primary holds a `fiscal.aeat` row (a preproduction venue may have none —
  absence is normal, not an error).
- The primary reads its own `fiscal.aeat` credential (`getCredential(tx, ring, …)`, `app_user` holds
  SELECT) inside `assembleMirrorBundle`.
- It crosses the **same admin-authenticated HTTPS response** the `syncToken` already rides in
  plaintext (`mirror-bundle-api.ts`, admin login in the request body). **Decision (owner-approved):**
  the plaintext PFX transiting that channel is the accepted posture — identical to the sync token and
  the admin password today. The PFX lives in the mirror's memory only for the duration of adopt; it
  is never written to the mirror's disk in plaintext.

### 2.2 The mirror wraps it under the break-glass secret and stores it dormant

`adoptFromPrimary` (`apps/server/src/adopt.ts:211`) already mints the break-glass secret (192-bit
`generatePassword()` = 32 base64url chars, clearing the envelope's 12-char floor), stores only its
scrypt verifier on `deployment.break_glass_verifier`, and returns the raw secret once. This design
threads that raw secret — in hand at that point — into one more step, ordered **before**
`mintBreakGlassSecret` returns:

1. Wrap the bundle's `aeatCert` under a key **derived from the break-glass secret** using the shared
   scrypt + AES-256-GCM envelope (`encryptSecretEnvelope`, §2.3).
2. Seal the resulting envelope as an ordinary vault row under a **new purpose**
   `fiscal.aeat.dormant`, payload `{ envelope: <string> }` (§6.1), via `putCredential`.

The result is **double-wrapped**: the vault ring key opens the row to an envelope, and only the
break-glass secret opens the envelope to the PFX. Consequences:

- Nothing on the instance — disk, database dump, `secrets.env`, or the running process's own vault
  key — can produce the PFX from the dormant row. The break-glass secret is on **no node**; the
  operator holds it (shown once at adopt). The verifier and the envelope's wrapping key derive from
  the same secret with **different salts** (the verifier's scrypt salt vs the envelope's own random
  salt), so a stolen verifier reveals nothing about the wrapping key.
- The drain reads purpose `fiscal.aeat`, never `fiscal.aeat.dormant`, so a dormant standby is
  correctly _not_ a filing node.

**Losing the break-glass secret** is recovered uniformly by the admin-login path, never by re-adopt:
promote with admin login (the node sells) and install the certificate by hand on the now-primary
(§3.3). Re-adopt is **not** offered as routine recovery — it mints a fresh `nodeId` each call while
`establishReservedStandbyIdentity` early-returns on the existing `membership.node_key`
(`reserved-identity.ts:66-71`), so a second adopt can leave `trading.env`'s `nodeId` diverged from
the reserved SIF's node (`adopt.ts:115,189-198`) and burns a primary-side reservation each time; its
idempotency is unproven (`adopt.test.ts` exercises no second adopt) and fixing it is out of scope
(§8).

### 2.3 The shared envelope primitive lives in `apps/server`, not `credentials`

`encryptBundle`/`decryptBundle` in `apps/server/src/recovery-bundle.ts` are extracted to
`apps/server/src/secret-envelope.ts` as `encryptSecretEnvelope(plaintext: string, passphrase)` /
`decryptSecretEnvelope(envelopeJson, passphrase)` — same scrypt KDF (`scrypt-kdf.ts`), same
AES-256-GCM, same self-describing envelope, same untrusted-input bounds. `recovery-bundle.ts` becomes
one caller (files → JSON → envelope); the dormant cert is another (cert JSON → envelope). It stays in
`apps/server` because (a) both callers (adopt, unlock) are in `apps/server` — there is no fiscal-regime
caller, so the earlier "move it to a leaf package" motive was wrong; and (b) `@waitron/credentials`
has **no scrypt** (verified: empty grep), while the three envelope error codes
(`recovery.passphrase_too_short`, `recovery.passphrase_invalid`, `recovery.bundle_invalid`) are
declared in `apps/server/src/errors.ts:1531-1537` and cannot follow the code into a leaf without
moving the registry. No package move; the codes stay put.

### 2.4 `tenant_credentials` is reclassified `state` → `local`

`packages/credentials/src/classification.ts:12` currently classifies `tenant_credentials` as `state`
("copied to a standby, never drained back" — `packages/sync-enrolment/src/classification.ts`). That is
**wrong** and this slice corrects it: a vault row is sealed under the node's own box key, so a copied
row is undecryptable on the peer AND collides on the shared `(tenant_id, purpose)` PK with the peer's
own `membership.node_key` / `sync.mirror_token` rows. That is the definition of `local` ("this node's
own record of what it is: not copied, not drained"). Today the misclassification is inert — no
`CREATE PUBLICATION` exists yet (`apps/server/src/modules.ts:44-45`: the publications are "DERIVED,
not yet consumed at runtime") — but once the swap's S2 builds them, the primary's `fiscal.aeat`
ciphertext would replicate onto the standby, land as a **present-but-undecryptable** row, and (per §1)
throw `credentials.decrypt_failed` on every drain pass **without** flipping the awaiting cell — a
silent filing outage. Reclassifying to `local` is what makes the whole design's premise true: secrets
a standby needs cross by **re-sealing at adopt** (the sync token today, `fiscal.aeat.dormant` here),
never by replication. Guarded by `classification.test.ts` (completeness); the reclassification is an
edit to that list with the reason in the commit. The plan greps for any consumer that depends on the
`state` class specifically (none known — publications are unbuilt) and re-runs the root classification
guards.

---

## 3. Unlock and install — the two ways a certificate reaches a live row

A **live** `fiscal.aeat` row (the one the drain reads) is written on a promoted **primary** in one of
two ways, plus the install/replace path that doubles as renewal. Every write endpoint here is
**primary-only**: a mirror refuses all write verbs at the read-only gate (`read-only-gate.ts`, only
`/api/box/retire`, `/management-api/promote` and peer-sync `/sync-api/cursor` are exempt), so none of
these routes needs — or gets — a new gate exemption. A mirror never holds a live certificate; that is
the exposure this design removes.

### 3.1 Promote with break-glass → unlock in the same step

When the operator promotes with the break-glass secret (the failover case where the node holding the
admin's credentials is the very one that died — `promote-api.ts:9-16`), the promote `run` closure:

1. Verifies the secret (existing `verifyBreakGlass`) — authorization, unchanged.
2. Reads the `fiscal.aeat.dormant` row and `decryptSecretEnvelope(envelope, breakGlass)` **in
   memory, before the point-of-no-return transaction** (the scrypt open is ~128 MiB and must not sit
   inside the promotion commit).
3. If the envelope opens: seals the plaintext as the live `fiscal.aeat` row **inside
   `commitMirrorPromotionTx`** (`promote.ts:220`), so "became primary" and "holds the filing
   certificate" commit or roll back together. `putCredential` there is safe — the owner tx holds
   INSERT/UPDATE on `tenant_credentials` (so does `app_user`, `0001_credentials_baseline_sql.sql:3`),
   and credentials declares no sync enrolment so no capture trigger needs the `app.node_id` GUC. The
   next drain pass files; `awaitingFiscalCertificate` never goes true.
4. If the envelope does **not** open (verifier matched but the blob is corrupt or was wrapped under a
   different secret): the promotion **still succeeds** — the node sells — and the corrupt dormant row
   is **deleted**, so status falls to `"none"` ("install a certificate", §5) rather than looping on
   "present your break-glass secret". `fiscal.certificate_unlock_failed` is logged. It does **not**
   abort the promotion.

Point 4 is a **deliberate change from `2026-08-29` §7**, which said a node that cannot unseal the
certificate must abort before claiming singletons. That predates "sell now, file later" (#272); under
the current posture, refusing to promote would block _selling_, which §5 (nothing external blocks a
sale) and the 08-29 design's own §3 forbid. An unlock failure withholds _filing_, never _selling_.

Threading detail (plan): the verified break-glass secret must reach `run` → `promoteMirrorToPrimary`
(today `run`/`promote-api.ts:50` carry no secret), and the **already-primary** early return
(`promote.ts:268-272`) must not silently skip an unlock — an admin-login-promote-then-break-glass
sequence either unlocks on that path too or is told to use `/unlock`. Absent a dormant row entirely
(a preproduction venue), break-glass promotion just promotes and sells — no unlock, no error.

### 3.2 Promote with admin login → sell, await, unlock later

Admin-login promotion carries no secret, so it cannot unlock. The node promotes, sells, and shows
`awaitingFiscalCertificate: true` (as #272 ships). The operator unlocks when ready via
`POST /management-api/fiscal-certificate/unlock { breakGlass }` on the (now-)primary: verify the
secret, open the dormant envelope, seal the live `fiscal.aeat` row (a normal transaction). A wrong
secret → `promotion.break_glass_invalid` (existing code, same domain concept). No dormant row →
`fiscal.certificate_dormant_missing`. A corrupt envelope → `fiscal.certificate_unlock_failed` (a 4xx
here, and the corrupt dormant row is deleted, as in §3.1 point 4). On a mirror the read-only gate
answers first with `node.read_only` — that IS the refusal; there is no mirror-specific code.

### 3.3 Install / replace — the renewal path and the lost-secret fallback

`POST /management-api/fiscal-certificate { <admin login>, aeatCert: { pfxBase64, passphrase, certKind } }`
on a **primary**, authorized by admin login carrying a new admin-only permission `fiscal.configure`
(§6.2). The certificate is validated through the regime's existing `provisioningSecret.validate` seat
(`provisioning-secret.ts:32-83`) **before** anything is written, so a malformed
`certKind`/`pfxBase64`/`passphrase` is rejected (`setup.request_invalid` / `credentials.invalid_field`)
and never sealed. Then it seals (overwrites) the live `fiscal.aeat` row. This is the
**certificate-renewal** path that does not exist today, and the fallback when the break-glass secret
is lost after the primary died (promote with admin login → install by hand). On a mirror the
read-only gate refuses it (`node.read_only`).

**Refreshing the standby's dormant copy after a renewal is deferred (§8).** Consequence, stated so it
is not silent: after a renewal on the primary, the standby's dormant copy still holds the _old_
certificate until a re-provision reaches it. A promotion in that window unlocks the stale certificate,
which fails filing **loudly** (AEAT rejects an expired/revoked cert; the drain surfaces the rejection)
and is fixed by installing the new certificate by hand on the now-primary — never a silent wrong
filing. The clean refresh mechanism (the S2 replication lane once `tenant_credentials` is `local` and
re-sealing is added, or a fixed idempotent re-adopt) is follow-up work.

---

## 4. The cloud vault key comes from outside the machine

The weak spot for a cloud node — **primary or standby** — is that the vault key is minted onto the
same instance's disk as the database, so a disk snapshot, a leaked image, or a backup artifact (which
bundles `secrets.env` _and_ the dump — `state-secrets.ts:15-22`) hands over a usable certificate.

### 4.1 Both boot branches accept an externally-supplied key; on-prem is untouched

Two boot branches read the ring differently today: the **trading** branch reads it from `env`
(`boot.ts:899`), the **setup** branch — the one that serves `/setup-api/adopt` — reads it back from
disk unconditionally (`boot.ts:711-712`, `readFileSync(secrets.env)`). So accepting an env key means
changing **both** `ensureBoxSecrets` (mint no `secrets.env` when `WAITRON_CREDENTIALS_KEY` is already
in the environment) **and** the setup branch's ring load (`boot.ts:704-713`) to **env first, file
fallback**. Waitron Cloud then holds the key in its secrets service and injects it into the process
environment at start, the instance having proved a platform machine identity (an IAM role /
instance-identity token — not a file, absent from any snapshot or dump). Machine identity and the
secrets service are Waitron Cloud's job; this repo only honours a key already in the environment.

**Precedence, defined once and enforced in one place:** the **environment key wins**. If a usable env
key AND a `secrets.env` are both present and they **differ**, the node refuses to boot loudly (rather
than seal under one ring and read under the other → `credentials.decrypt_failed`). The on-prem box is
unchanged: no env key, so it mints `secrets.env` as today, and reads it back as today. A missing key
at boot stays a loud refusal (`credentials.key_missing`); key availability is Waitron Cloud's
availability problem, the same as the instance itself. The existing non-ENOENT rethrow
(`box-secrets.ts:46-57`) is untouched.

### 4.2 Backups from an env-keyed node carry no key

`collectStateSecrets` gains a parameter telling it the key is external; `secrets.env` then becomes
optional in the artifact and the manifest records `credentialsKey: "external"` (an on-prem box's
artifact still carries `secrets.env` and records `"embedded"` — there is nowhere else to hold the key
there). Restoring an `"external"` artifact onto a node with **no** env key fails loudly with
`restore.credentials_key_external` ("this backup's vault key is held externally — supply
`WAITRON_CREDENTIALS_KEY`") rather than producing a vault nothing can open. The recovery **bundle**
(`recovery-bundle-api.ts`, which shares `collectStateSecrets`) means the same on an env-keyed node: it
carries no key, and unpack requires the env key to be supplied.

### 4.3 (Split to a fast-follow) Restoring an on-prem artifact onto a cloud node

The disaster path "the box died, there is no standby, move the venue to a fresh cloud node": the
artifact carries the box's `secrets.env`, but the cloud node must end with every vault row encrypted
under **its own env key**, never the box key on cloud disk. That needs a **`reencryptVault`** that
reads each row under the box ring and rewrites under the cloud ring. It is **split to its own
fast-follow** because it is reachable only on this disaster path (whereas §4.1–4.2 are needed by every
cloud node from day one, and §2–3 do not depend on it at all), and the review surfaced enough sharp
edges that it deserves its own plan:

- Both keys are `key_version = 1` (`generateKeyRing` always mints v1), so they **cannot share a
  `KeyRing`** — `loadKeyRing` refuses a same-version current+previous pair
  (`credentials.key_ring_version_collision`), and `rotateCredentials` is built on such a ring.
  `reencryptVault` must use **two sequential single-key rings** (read under box, write under cloud),
  never one ring holding both, and must run in **one transaction** (rotate's per-row resumability
  relies on distinct versions, which two v1 keys do not have — a half-done re-encrypt would be
  undetectable). Safe because the restore target is unbooted with no concurrent writers.
- The box ring is built with `loadKeyRing(parseEnvFile(artifact secrets.env))` so a mid-rotation
  artifact carrying `_PREVIOUS` is handled.
- `restore.ts:371-386` (`restoreSecrets`) currently writes every `secrets/*` entry including
  `secrets.env`; the env-key target must skip that write (the box key never lands on cloud disk).
  `restore-command.ts` currently has no ring and must take the cloud key from `WAITRON_CREDENTIALS_KEY`.

This subsection is documented here for continuity; its tasks land in the fast-follow plan, not this
one.

---

## 5. What the operator sees

- `BoxStatus` gains `fiscalCertificate: "live" | "dormant" | "none"` — distinct from the existing
  `cert` field, which is the server **TLS leaf** (`box-status.ts:34`). It is computed by an
  **existence check** on the two purposes (never `tryGetCredential`, which throws on an
  undecryptable row): a `fiscal.aeat` row → `"live"`; else a `fiscal.aeat.dormant` row → `"dormant"`
  ("present your break-glass secret to unlock"); else `"none"` ("install a certificate"). It sits
  beside the existing `awaitingFiscalCertificate` boolean. The read is tenant-scoped (`withTenant`,
  and it scopes to the tenant itself — one-tenant-per-database is not the isolation boundary,
  CLAUDE.md §3). After a failed unlock the corrupt dormant row is deleted (§3.1/§3.2), so this
  correctly reads `"none"` and signposts the install path — no retry-forever loop.
- Log events, never the material: `fiscal.certificate_dormant_stored` (adopt),
  `fiscal.certificate_unlocked` (break-glass promote or `/unlock`), `fiscal.certificate_installed`
  (install/replace), and the failure `fiscal.certificate_unlock_failed`.
- The adopt UI copy that surfaces the break-glass secret once (`apps/setup`, `done-screen.ts`) is
  reworded: the secret now "authorizes promotion **and** unlocks your fiscal certificate — without it
  a promoted node sells but cannot file until you install the certificate by hand." A friendly
  dashboard UI for `/unlock` and install is **out of scope** (§8) — this slice ships the endpoints,
  the status field, and the reworded once-shown copy.

---

## 6. Registry, permission, and vocabulary deltas

### 6.1 New vault purpose

`packages/credentials/src/purposes.ts`: add `"fiscal.aeat.dormant": ["envelope"]`. Verified sound:
`isPurpose` is `hasOwnProperty`; `credential_tenants` matches purpose exactly; `aadFor` is
NUL-separated so `fiscal.aeat` and `fiscal.aeat.dormant` cannot alias; nothing splits a purpose on
dots; `rotateCredentials` iterates `Object.keys(PURPOSES)` and re-seals the **outer** (ring-key)
layer with the envelope as opaque payload — correct, since the break-glass secret is not a vault key.
`purposes.test.ts` pins the exact purpose list — updated (expected).

### 6.2 New permission

`packages/identity/src/permissions.ts`: add `"fiscal.configure"` — admin-only (in `ALL`, not
`SUPERVISOR`/`MANAGER`), the shape of `node.promote`/`mirror.create`. Gates the install/replace
endpoint (§3.3). `permissions.test.ts`'s `ADMIN_ONLY` set is updated (expected).

### 6.3 New error codes (domain-concept named, never the throwing package — CLAUDE.md §3)

| Code | Params | Raised |
| --- | --- | --- |
| `fiscal.certificate_dormant_missing` | `{ tenantId }` | `/unlock` on a primary with no dormant row |
| `fiscal.certificate_unlock_failed` | `{ tenantId }` | break-glass verified but the envelope will not open (a 4xx on `/unlock`; a logged status on the promotion path — §3.1 point 4) |
| `restore.credentials_key_external` | `Record<string, never>` | restoring an external-key artifact onto a node with no env key (§4.2) |

- `restore.*`, not `recovery.*` — the code is raised by **restore**, whose siblings are all `restore.*`
  (`errors.ts:1619-1695`); `recovery.*` is the recovery-**bundle** family (passphrase/envelope,
  `:1529-1541`). This is the `payments.`/`payment.` lesson (CLAUDE.md §1).
- These three, plus the `fiscal.certificate_*` pair, are declared in `apps/server/src/errors.ts`.
  **They are the first `fiscal.` AppError codes raised from `apps/server`** (grep: `fiscal.` codes
  exist only in `packages/fiscal*`), which is correct by the domain-concept rule — the concept is the
  fiscal certificate, and `pass.ts` already emits `fiscal.awaiting_certificate` /
  `fiscal.certificate_available` as **log events** from `apps/server`. `apps/server` may not import
  the regime, but an AppError code is a string it declares locally, not a regime import.
- **Reachability is not auto-guarded here:** `scripts/errors-reachable.test.ts` excludes `apps/*` by
  construction (`:99-100`). The plan adds a targeted reachability assertion for the new
  `apps/server` codes rather than relying on the root guard.
- `promotion.break_glass_invalid` (existing) is reused for a wrong secret on `/unlock`. No mirror
  install/unlock refusal code exists — the read-only gate is the refusal (§3).

### 6.4 Vocabulary

No new Spanish. `fiscal.aeat.dormant`, `fiscal.configure`, and the codes are English identifiers; the
only Spanish present (`sello`, `representante`) is unchanged in `FISCAL_VOCABULARY` (CLAUDE.md §3).

---

## 7. Testing — prove by running, not by reading (CLAUDE.md §1, §4)

The load-bearing proofs run against **real Postgres** as the non-superuser deployment role and, where
filing is claimed, a **real mTLS handshake** (the test CA + PKCS#12 fixture at
`apps/server/src/testing/tls.ts` and the `FakeAeat` SOAP stub at
`packages/verifactu/src/testing/fake-aeat.ts`).

1. **Two-node e2e** — but **not** by extending `promote-endpoint-e2e.test.ts` as-is: that suite mocks
   `undici.fetch` to **reject globally** (`:70-79`), so a real filing cannot pass and un-mocking it
   revives the background pull/tunnel dials the mock suppresses. Use a **per-host** fetch mock (the
   AEAT host reaches `FakeAeat`; every other host rejects) or a dedicated suite. It proves: A (primary,
   holds a real `fiscal.aeat`) → B adopts → B has a `fiscal.aeat.dormant` row and **no** `fiscal.aeat`
   row; then promote B **with break-glass** → B seals a live row, its drain does a **real mTLS
   handshake** and files (a registro with a real `estado`), `awaitingFiscalCertificate` stays `false`;
   promote B **with admin login** instead → still awaiting, no live row, then `POST /unlock` with
   break-glass → live row, next drain files; **wrong** break-glass on `/unlock` →
   `promotion.break_glass_invalid`, no live row.
2. **Wrong-purpose seal probe** (the real bug worth catching, lighter target — this is crypto, not
   privileges, so PGlite with a note): open the vault `fiscal.aeat.dormant` row and assert its payload
   is `{ envelope }` with **no** `pfxBase64` (a certificate accidentally sealed in the clear under the
   dormant purpose would show `pfxBase64` here). The "envelope won't open without the secret" property
   is AES-GCM's own and is not worth a test (CLAUDE.md §1 — a probe whose failing case cannot exist).
3. **Corrupt-dormant control** (§3.1 point 4): a dormant envelope wrapped under a _different_ secret →
   break-glass verifies, promotion lands selling (assert a sale succeeds on the promoted node), the
   corrupt dormant row is **deleted** (status reads `"none"`), `fiscal.certificate_unlock_failed`
   logged.
4. **Env-key boot** (real PG for the seal/open, plus a boot test on the **setup** branch — the one
   that adopts, not just a direct `ensureBoxSecrets` call): first boot with `WAITRON_CREDENTIALS_KEY`
   set → **no `secrets.env` on disk**, the setup branch builds the ring from env and adopt can seal;
   both-present-and-different → loud boot refusal; backup manifest records `credentialsKey:
   "external"`; restore of an `"external"` artifact onto a keyless node → `restore.credentials_key_external`.
5. **Install/replace**: overwrite on a primary (admin login + `fiscal.configure`); a malformed
   certificate rejected by the `validate` seat **before any write** (assert the vault is unchanged);
   refused on a mirror by the read-only gate (`node.read_only`).
6. **Reachability**: the new `apps/server` codes are constructible/reachable (targeted, since the root
   guard excludes `apps/*`).

After the schema/registry/classification touches, re-run the credentials package suites and the root
guards: `errors-reachable`, `english-only`, and **`classification.test.ts` + `classification-complete`
/ `append-only-enable-always`** (the reclassification of `tenant_credentials`, §2.4 — assert it now
reports `local`, and that no publication consumer regressed). `fiscal.aeat.dormant` is a purpose, not
a `drizzle/` table, so no new table classification is added — assert that explicitly rather than
assume it.

---

## 8. Out of scope (this slice)

- **§4.3 restore-onto-cloud re-encrypt** — split to its own fast-follow (§4.3), disaster path only.
- **Refreshing the standby's dormant copy after a certificate renewal** — via the S2 replication lane
  (once `tenant_credentials` is `local` and re-sealing is added) or a fixed idempotent re-adopt. The
  renewal path itself (primary install) IS in scope; only the automatic standby refresh is deferred,
  with §3.3's loud-failure consequence stated.
- **A fixed, idempotent re-adopt** (needed before re-adopt can be the standby-refresh mechanism) —
  §2.2's caveat; out of scope here.
- **Dashboard UI** for `/unlock` and install — API + status field + reworded adopt copy only.
- **Certificate-expiry warnings / proactive renewal reminders.**
- **Automatic primary→standby push of a renewed certificate** — needs a node-to-node public-key
  primitive the repo does not have; two installs every few years (or a re-provision) is the accepted
  cost.
- **On-prem full-disk encryption / TPM** — an OS-image concern (`2026-08-26-appliance-onboarding-design.md`
  §9). No code here.
- **Re-admission's certificate cleanup** — when a promoted node is re-admitted as a standby (owed R3
  follow-up (b)), it must **delete its live `fiscal.aeat` row** and hold only the dormant copy again.
  Belongs to the re-admission slice; the backlog entry for it now carries this one-line note.

---

## 9. What this supersedes

- `2026-08-29-promotion-runbook-design.md` §4–5's "break-glass unlocks the key ring to unseal a
  **replicated** certificate blob" — there was never a replicated certificate; the standby held
  nothing. This design is the first mechanism that puts a (wrapped) certificate on the standby. The
  08-29 §7 "abort promotion if the certificate cannot be unsealed" is replaced by §3.1 point 4
  (withhold filing, never selling), consistent with sell-now-file-later (#272). Dated pointers are
  added to both sections rather than rewriting them (CLAUDE.md §6).
- `2026-09-07-promote-endpoint-slice-2-design.md` §4.3's "named dependency: cert distribution to a
  promoted mirror (re-seal `fiscal.aeat` at adopt, or ship it in the bundle)" — this is that
  dependency, resolved as "ship it in the bundle, wrapped under break-glass, sealed dormant, with the
  vault table reclassified `local` so replication never carries it."

---

## 10. What the fresh-context fiscal review changed (2026-09-07)

The review (fresh context, against the code) reshaped the first draft; the changes above, in order of
impact: **(a)** §4.1 now fixes **both** boot branches — the setup branch reads `secrets.env`
unconditionally (`boot.ts:711-712`), which the first draft missed, and precedence is defined; **(b)**
all install/unlock endpoints are **primary-only** — the read-only gate refuses mirror writes before
any handler (`read-only-gate.ts`), so the first draft's mirror re-wrap path was unreachable and is
dropped (standby refresh deferred to §8); **(c)** `tenant_credentials` is **reclassified `state` →
`local`** (§2.4) — it was misclassified as replicated, which would have broken the design's premise
once publications land; **(d)** the shared envelope stays in `apps/server` (§2.3), not a leaf package
(`credentials` has no scrypt; no fiscal-regime caller); **(e)** `restore.credentials_key_external`,
not `recovery.*` (§6.3); **(f)** the reachability guard does **not** cover `apps/*` codes, so a
targeted assertion is added (§6.3, §7.6); **(g)** three §7 tests were false passes (global undici
mock, a collision "control" that bypasses `loadKeyRing`, an AES-GCM tautology) and are rewritten;
**(h)** re-adopt is removed as routine lost-secret recovery — its idempotency is unproven — replaced
by admin-login-promote + install by hand (§2.2). Sound-as-drafted and confirmed by the review: the
`fiscal.aeat.dormant` purpose name, the `fiscal.configure` permission, the double-wrap salts, and
that promotion touches no credential so the reserved-SIF activation is independent of cert presence
(§3.1).
