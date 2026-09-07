# Fiscal certificate distribution to a promoted node — design

Date: 2026-09-07. Track B item 3 follow-up ("cert distribution to a promoted mirror" — the named
dependency that unblocks _filing_ on a promoted cloud, `docs/backlog.md` Track B item 3 "STILL
OWED"). Supersedes the "unlock the key ring" framing of
`2026-09-05` / `2026-08-29-promotion-runbook-design.md` §4–5 (see §9).

Single slice (owner decision 2026-09-07: "do both in one"). It has two coupled halves that both
answer one question — _where does the key that opens the AEAT certificate live, on each kind of
node_ — plus the operator surface and the missing renewal path that fall out of them.

---

## 1. The problem, and the invariant that shapes the fix

A cloud **mirror** that is promoted to primary sells and chains on its own reserved SIF but **cannot
file** with AEAT, because it does not hold the venue's AEAT certificate. Today that is honest and
loud — `awaitingFiscalCertificate` on box-status, "sell now, file later" (#272) — but it is a dead
end: nothing can ever put the certificate on the promoted node.

Structural state today (verified by structural read this session; receipts inline):

- The certificate is a vault row `tenant_credentials(tenant_id, "fiscal.aeat")` holding
  `{ pfxBase64, passphrase, certKind }`, sealed AES-256-GCM
  (`packages/credentials/src/purposes.ts:29`, `.../cipher.ts`), under a **random 32-byte key** the
  node mints for itself at first boot into `<stateDir>/secrets.env` (0600)
  (`apps/server/src/box-secrets.ts:134-144`).
- A cloud node mints its **own, different** key the same way, so nothing sealed on the box could open
  on the cloud even if the row were copied. Nothing tries: the adopt bundle carries the sync token in
  plaintext (re-sealed mirror-side) but **deliberately not** the certificate
  (`apps/server/src/mirror-bundle.ts:60-75`, `apps/server/src/adopt.ts:106-214`).
- The drain reads only `fiscal.aeat`; a missing row makes it **skip that tenant** — no throw, no
  stall — and flips the shared `AwaitingCertStatus` cell (`packages/fiscal-verifactu/src/drain.ts:193-206`,
  `apps/server/src/pass.ts:74-131`).
- There is **no primitive in the repo** to wrap a secret to another node's public key (Ed25519 is
  signature-only; no X25519/HPKE/sodium anywhere). The only envelope that exists is
  passphrase-derived scrypt + AES-256-GCM (`apps/server/src/recovery-bundle.ts:38-64`).
- There is **no endpoint to install or replace a certificate** after setup
  (`apps/server/src/setup-api.ts:424` is the only seal site) — so certificate renewal (every few
  years) has no path today either, independent of failover.

**The hard ceiling (stated plainly so the design is honest about it).** A node that files unattended
must be able to open its certificate with no human present at boot — the drain retries hourly. So the
_running process_ can always open the certificate; we cannot defend against a live compromise of that
specific process (root on the box, memory access) short of hardware-backed TLS keys, which
undici/mTLS cannot drive. What this design _does_ guarantee is that the certificate is openable
**only inside the running process** — never from a disk image, a database dump, a snapshot, or a
backup artifact taken from that node. Everything bulk-stealable stops yielding a usable certificate;
only a live process compromise does. That is the standard posture for unattended services holding
signing material (envelope encryption + externally-held key), and it is the same rule on every node
kind:

| Node kind | What guards the key that opens the certificate |
| --- | --- |
| On-prem box | the disk itself (full-disk encryption, TPM-sealed auto-unlock) — an OS-image concern, already decided in `2026-08-26-appliance-onboarding-design.md` §9; **no code here** |
| Cloud node (primary or standby) | Waitron Cloud's secrets service holds the vault key; the instance proves a machine identity to fetch it at boot (§4). The disk holds only ciphertext |
| Cloud standby, pre-promotion | additionally wrapped under the operator's **break-glass secret**, which is on no node at all (§2–3) |

The two halves of this slice are §2–3 (the standby's dormant copy and its unlock/install paths) and
§4 (cloud nodes take the vault key from the environment; backups carry no key). §5–8 are the
operator surface, the error/vocabulary deltas, testing, and scope.

---

## 2. The dormant copy — established at adopt

The standby receives the certificate at adopt, but wrapped so that **nothing on the cloud instance
can open it** until the operator presents the break-glass secret at promotion. This mirrors how the
reserved SIF already works: the full dormant identity is seeded at join and activated on promotion
(`reserved-sif-seeded-at-join`).

### 2.1 The bundle carries the plaintext certificate

`MirrorBundle` (`apps/server/src/mirror-bundle.ts:60-75`) gains one optional field:

```
aeatCert?: { pfxBase64: string; passphrase: string; certKind: CertKind }
```

- Present only when the primary holds a `fiscal.aeat` row (a preproduction venue may have none —
  absence is normal, not an error).
- The primary assembles it by reading its own `fiscal.aeat` credential
  (`getCredential(tx, ring, { purpose: "fiscal.aeat" })`) inside `assembleMirrorBundle`.
- It crosses the **same admin-authenticated HTTPS response** the `syncToken` already rides in
  plaintext (`mirror-bundle-api.ts`, admin login in the request body). **Decision (owner-approved):**
  the plaintext PFX transiting that channel is the accepted posture — identical to the sync token and
  the admin password today. The PFX lives in the mirror's memory only for the duration of adopt; it
  is never written to the mirror's disk in plaintext.

### 2.2 The mirror wraps it under the break-glass secret and stores it dormant

Today `adoptFromPrimary` (`apps/server/src/adopt.ts:211`) already **mints the break-glass secret**
(192-bit, `generatePassword()`), stores only its scrypt verifier on
`deployment.break_glass_verifier`, and returns the raw secret once for the setup UI to surface. This
design threads the raw secret — already in hand at that point — into one more step, ordered
**before** `mintBreakGlassSecret` returns:

1. Wrap the bundle's `aeatCert` under a key **derived from the break-glass secret** using the
   existing scrypt + AES-256-GCM envelope, generalised from `recovery-bundle.ts` into a shared
   `encryptSecretEnvelope(plaintextJson, passphrase)` / `decryptSecretEnvelope(envelope, passphrase)`
   pair (§2.3). The envelope is self-describing (records its own KDF params + salt), exactly as the
   recovery bundle's is.
2. Seal the resulting envelope as an ordinary vault row under a **new purpose**
   `fiscal.aeat.dormant`, payload `{ envelope: <string> }` (§6.1), via `putCredential`.

The result is **double-wrapped**: the vault ring key opens the row to an envelope, and only the
break-glass secret opens the envelope to the PFX. Consequences:

- Nothing on the instance — disk, database dump, `secrets.env`, or the running process's own vault
  key — can produce the PFX from the dormant row. The break-glass secret is on **no node**; the
  operator holds it (shown once at adopt).
- The verifier (`deployment.break_glass_verifier`) and the envelope's wrapping key are both derived
  from the same secret but with **different salts** (the verifier's scrypt salt vs the envelope's own
  random salt), so a stolen verifier reveals nothing about the wrapping key.
- The drain reads purpose `fiscal.aeat` and never `fiscal.aeat.dormant`, so a dormant standby is
  correctly _not_ a filing node and `awaitingFiscalCertificate` stays `false` on it (it is not the
  singleton primary; `box-status.ts:38-42`).
- **Re-adopt** re-mints the break-glass secret and re-wraps the dormant row (the existing idempotent
  re-adopt path). This is also the answer to a lost break-glass secret _while the primary is alive_:
  re-adopt, get a fresh secret and a fresh dormant copy.

### 2.3 The shared envelope primitive

`encryptBundle`/`decryptBundle` in `apps/server/src/recovery-bundle.ts` are lifted to a
provider-neutral `encryptSecretEnvelope(plaintext: string, passphrase): string` /
`decryptSecretEnvelope(envelopeJson, passphrase): string` — same scrypt KDF, same AES-256-GCM, same
self-describing envelope, same untrusted-input bounds (`MAX_SCRYPT_N`, `MAX_PLAINTEXT_BYTES`). The
recovery bundle becomes one caller (files → JSON → envelope); the dormant cert is another (the cert
JSON → envelope). Home: `@waitron/credentials` (a leaf package that already owns AES-GCM and scrypt),
so both `apps/server` and the fiscal regime can reach it without a new dependency edge. The
`MIN_PASSPHRASE_LENGTH = 12` floor is satisfied automatically — the break-glass secret is 32 base64url
chars.

---

## 3. Unlock and install — the two ways a certificate reaches a live row

A **live** `fiscal.aeat` row (the one the drain reads) is written on a promoted node in one of two
ways, plus the install/replace path that doubles as renewal.

### 3.1 Promote with break-glass → unlock in the same step

When the operator promotes with the break-glass secret (the failover case where the node holding the
admin's credentials is the very one that died — `promote-api.ts:9-16`), the promote `run` closure:

1. Verifies the secret (existing `verifyBreakGlass`) — authorization, unchanged.
2. Reads the `fiscal.aeat.dormant` row, `decryptSecretEnvelope(envelope, breakGlass)` **in memory**.
3. If the envelope opens: seals the plaintext as the live `fiscal.aeat` row **inside
   `commitMirrorPromotionTx`** (`promote.ts:220`), so "became primary" and "holds the filing
   certificate" commit or roll back together. The next drain pass files; `awaitingFiscalCertificate`
   never goes true.
4. If the envelope does **not** open (verifier matched but the blob is corrupt or was wrapped under a
   different secret): the promotion **still succeeds** — the node sells — and lands in the
   awaiting-certificate state with a distinct, loud reason (`fiscal.certificate_unlock_failed`
   logged; surfaced on status). It does **not** abort the promotion.

Point 4 is a **deliberate change from `2026-08-29` §7**, which said a node that cannot unseal the
certificate must abort before claiming singletons. That predates "sell now, file later" (#272).
Under the current posture, refusing to promote would block _selling_ too — which §5 (nothing external
blocks a sale) and the 08-29 design's own §3 ("selling needs neither the peer nor the cert") forbid.
So an unlock failure withholds _filing_, never _selling_. The old abort framing is retired with a
dated pointer.

Absent a `fiscal.aeat.dormant` row entirely (a preproduction venue that never had a certificate),
break-glass promotion simply promotes and sells — no unlock attempted, no error.

### 3.2 Promote with admin login → sell, await, unlock later

Admin-login promotion carries no secret, so it cannot unlock. The node promotes and sells and shows
`awaitingFiscalCertificate: true`, exactly as #272 ships today. The operator unlocks whenever ready
via a new endpoint:

`POST /management-api/fiscal-certificate/unlock { breakGlass }` — on a **primary** only. Verifies the
break-glass secret, opens the dormant envelope, seals the live `fiscal.aeat` row (a normal
transaction, not the promotion one). Refused on a mirror (a live certificate on a read-only standby
is precisely the exposure this design removes) → `fiscal.certificate_install_refused`. A wrong secret
→ `promotion.break_glass_invalid` (the existing code — same domain concept). A missing dormant row →
`fiscal.certificate_dormant_missing`.

### 3.3 Install / replace — the renewal path and the lost-secret fallback

`POST /management-api/fiscal-certificate { <auth>, aeatCert: { pfxBase64, passphrase, certKind } }` —
the certificate is validated through the regime's existing `provisioningSecret.validate` seat
(`packages/fiscal-verifactu/src/provisioning-secret.ts:32-83`) **before** anything is written, so a
malformed `certKind`/`pfxBase64`/`passphrase` is rejected cleanly and never sealed.

- On a **primary**: authorized by admin login carrying a new admin-only permission `fiscal.configure`
  (§6.2). Seals (overwrites) the live `fiscal.aeat` row. This is the **certificate-renewal** path
  that does not exist today, and the fallback when the break-glass secret is lost after the primary
  has died (promote with admin login → install by hand).
- On a **mirror**: the body must additionally carry `breakGlass` (a live certificate is never sealed
  on a standby; the certificate is what the dormant copy is wrapped under). Re-wraps the
  `fiscal.aeat.dormant` row under the current break-glass secret. Without `breakGlass` →
  `fiscal.certificate_install_refused`.

A renewal is therefore "install on the primary, install on the standby" — two calls, once every few
years — or a re-adopt (which re-seeds the dormant copy from the primary's fresh certificate). No
automatic primary→standby push (that would need a public-key primitive the repo lacks; §8 defers it).

---

## 4. The cloud vault key comes from outside the machine

The weak spot for a cloud node — **primary or standby** — is that the vault key is minted onto the
same instance's disk as the database, so a disk snapshot, a leaked image, or a backup artifact (which
bundles `secrets.env` _and_ the dump — `state-secrets.ts:15-22`) hands over a usable certificate.

### 4.1 Boot accepts an externally-supplied key; on-prem is untouched

`ensureBoxSecrets` (`apps/server/src/box-secrets.ts`) changes so that **if
`WAITRON_CREDENTIALS_KEY` is already present in the process environment at first boot, the node uses
it and writes no `secrets.env`** (it still writes the TLS PEMs). That is the entire hook Waitron
Cloud needs: it holds the key in its secrets service and injects it into the process environment at
start, the instance having proved a platform machine identity (an IAM role / instance-identity token
— not a file, absent from any snapshot or dump). Machine identity and the secrets service are Waitron
Cloud's job; this repo only honours a key that is already in the environment.

The on-prem box is unchanged: no env key, so it mints `secrets.env` exactly as today. A missing key
at boot stays what it is now — the node refuses to start, loudly (`credentials.key_missing`); key
availability is Waitron Cloud's availability problem, the same as the instance itself.

The idempotency contract is preserved: presence of an env key OR an existing `secrets.env` means "do
not mint". The existing non-ENOENT rethrow (`box-secrets.ts:46-57`) — which refuses to treat an
unreadable file as absent and orphan the vault — is untouched.

### 4.2 Backups from an env-keyed node carry no key

`secrets.env` becomes **optional** in `RECOVERY_FILES`/`collectStateSecrets`
(`state-secrets.ts:15-42`) when the key is external: a node with no `secrets.env` on disk produces a
backup whose manifest records `credentialsKey: "external"`. Restoring such an artifact onto a node
that has **no** env key fails loudly with `recovery.credentials_key_external` ("this backup's vault
key is held externally — supply `WAITRON_CREDENTIALS_KEY`") rather than producing a vault nothing can
open. An on-prem box's backup still carries `secrets.env` (there is nowhere else to hold the key
there), and its manifest records `credentialsKey: "embedded"`.

### 4.3 Restoring an on-prem artifact onto a cloud node — re-encrypt to the env key

The disaster path "the box died, there is no standby, move the venue to a fresh cloud node": the
artifact carries the box's `secrets.env` (its vault key), but the cloud node must end up with every
vault row encrypted under **its own env key**, never the box's key on cloud disk (§1's rule). Restore
therefore **re-encrypts every vault row** from the artifact's box key to the cloud's env key, then
discards the artifact key (never writes it to disk).

**Trap, surfaced so the plan does not fall into it.** Two independently-minted keys are **both
`key_version = 1`** (`generateKeyRing` always mints version 1 — `keyring-command.ts:20-26`). So they
**cannot coexist in one `KeyRing`**: `loadKeyRing` refuses a current+previous pair sharing a version
(`credentials.key_ring_version_collision`, `keyring.ts`), and `rotateCredentials` is built on exactly
such a two-key ring. The re-encrypt here must **not** build a two-key ring. Instead it reads each row
with a standalone single-key ring (the box key at its own version) and rewrites with a standalone
single-key ring (the cloud key), stamping the row's `key_version` to the cloud key's version — two
sequential single-key rings, never one ring holding both. A new
`reencryptVault(db, { fromKey, toKey })` in `@waitron/credentials` expresses this (sibling to
`rotateCredentials`, which stays the in-place ring-rotation tool). This is the one genuinely new
crypto-adjacent helper in the slice; it reuses the existing `sealValue`/`openValue` primitives and
invents no new scheme.

**Severability.** §4.3 is the one part that may split to a fast-follow if the plan finds it heavy: it
is only reachable on box-death-with-no-standby-to-cloud, a disaster path, whereas §4.1–4.2 (env-key
acceptance, no-key backups) are needed by every cloud node from day one. §2–3 (the standby's dormant
copy) do not depend on §4.3 at all. The plan may land §4.3 as its own task or defer it with a backlog
note; §4.1–4.2 do not defer.

---

## 5. What the operator sees

- `BoxStatus` gains `fiscalCertificate: "live" | "dormant" | "none"` — distinct from the existing
  `cert` field, which is the server **TLS leaf** (`box-status.ts:34`). It lets the dashboard say
  "present your break-glass secret to unlock" (dormant) vs "install a certificate" (none) vs healthy
  (live), alongside the existing `awaitingFiscalCertificate` boolean. Read by checking which of the
  two vault rows exist for the tenant (a tenant-scoped read — `withTenant`, and it scopes to the
  tenant itself; one-tenant-per-database is not the isolation boundary, CLAUDE.md §3).
- Log events, never the material: `fiscal.certificate_dormant_stored` (at adopt),
  `fiscal.certificate_unlocked` (promote-with-break-glass or `/unlock`),
  `fiscal.certificate_installed` (install/replace), and the failure `fiscal.certificate_unlock_failed`
  (§3.1 point 4).
- The adopt UI copy that surfaces the break-glass secret once (`apps/setup`, `done-screen.ts`) is
  reworded: the secret now "authorizes promotion **and** unlocks your fiscal certificate — without it
  a promoted node sells but cannot file until you install the certificate by hand." A friendly
  dashboard UI for `/unlock` and install is **out of scope** (§8) — this slice ships the endpoints,
  the status field, and the reworded once-shown copy.

---

## 6. Registry, permission, and vocabulary deltas

### 6.1 New vault purpose

`packages/credentials/src/purposes.ts`: add `"fiscal.aeat.dormant": ["envelope"]`. Exact-field
validation (`validatePayload`) then requires a single non-empty `envelope` string. `rotateCredentials`
iterates `Object.keys(PURPOSES)`, so the dormant row's **outer** (ring-key) wrapping rotates with
every other row; the **inner** (break-glass) envelope is opaque payload to the vault and is untouched
by rotation — correct, since the break-glass secret is not a vault key.

### 6.2 New permission

`packages/identity/src/permissions.ts`: add `"fiscal.configure"` — admin-only (in `ALL`, not in
`SUPERVISOR`/`MANAGER`), the shape of `node.promote`/`mirror.create`. Gates the install/replace
endpoint on a primary (§3.3).

### 6.3 New error codes (domain-concept named, never the throwing package — CLAUDE.md §3)

| Code | Params | Raised |
| --- | --- | --- |
| `fiscal.certificate_dormant_missing` | `{ tenantId }` | `/unlock` with no dormant row |
| `fiscal.certificate_install_refused` | `{ reason: "mirror_requires_break_glass" \| "unlock_on_mirror" }` | install on a mirror without break-glass; `/unlock` on a mirror |
| `fiscal.certificate_unlock_failed` | `{ tenantId }` | break-glass verified but the envelope will not open (§3.1 point 4) — a status/log reason, not a request rejection during promotion |
| `recovery.credentials_key_external` | `Record<string, never>` | restoring an external-key artifact onto a node with no env key (§4.2) |

`promotion.break_glass_invalid` (existing) is reused for a wrong secret on `/unlock`. No code is
renamed; `errors-reachable.test.ts` (root project) guards that every new code is reachable from its
package barrel.

### 6.4 Vocabulary

No new Spanish. `fiscal.aeat.dormant`, `fiscal.configure`, and the codes above are English
identifiers; the only Spanish already present (`sello`, `representante`) is unchanged and lives in
`FISCAL_VOCABULARY` (CLAUDE.md §3).

---

## 7. Testing — prove by running, not by reading (CLAUDE.md §1, §4)

The load-bearing proofs are run against **real Postgres** as the non-superuser deployment role and a
**real mTLS handshake**, because the whole point is what a role can decrypt and what a certificate can
do on the wire (the existing test CA + PKCS#12 fixture at `apps/server/src/testing/tls.ts` and the
`FakeAeat` SOAP stub at `packages/verifactu/src/testing/fake-aeat.ts` already exercise this).

1. **Two-node e2e** (extends `apps/server/src/promote-endpoint-e2e.test.ts`): A (primary, holds a
   real `fiscal.aeat` row) → B adopts → assert B has a `fiscal.aeat.dormant` row and **no**
   `fiscal.aeat` row. Then:
   - promote B **with break-glass** → B seals a live `fiscal.aeat`, its drain does a **real mTLS
     handshake** with the unlocked certificate against the test HTTPS server and files (a registro
     with a real `estado`); `awaitingFiscalCertificate` stays `false`.
   - promote B **with admin login** → still awaiting, **no** live row; then `POST /unlock` with
     break-glass → live row appears, next drain files.
   - **wrong** break-glass on `/unlock` → `promotion.break_glass_invalid`, no live row, mode
     unchanged.
2. **Ring-only compromise probe** (real PG): with B's vault ring key and database in hand (i.e. what a
   snapshot yields), open the `fiscal.aeat.dormant` row → you obtain an **envelope**; prove
   `decryptSecretEnvelope` throws without the break-glass secret. This is the §1 guarantee, run: a
   negative control that the dormant row alone is not a usable certificate.
3. **Corrupt-dormant control** (§3.1 point 4): a dormant envelope wrapped under a _different_ secret →
   break-glass verifies but promotion lands in awaiting-cert with `fiscal.certificate_unlock_failed`
   logged, and the node **still sells** (assert a sale succeeds on the promoted node).
4. **Env-key boot** (`box-secrets` unit + a boot test): first boot with `WAITRON_CREDENTIALS_KEY`
   set → **no `secrets.env` on disk**, vault seals/opens; backup manifest records
   `credentialsKey: "external"`; restore onto a keyless node fails with
   `recovery.credentials_key_external`; and (§4.3) restore of an **embedded**-key artifact onto an
   env-keyed node ends with every row readable under the new key and the box key on no disk. Include
   the **version-collision negative control**: assert the re-encrypt path never constructs a
   two-key ring (a direct `loadKeyRing` of the two v1 keys throws
   `credentials.key_ring_version_collision` — proving why `reencryptVault` uses sequential single-key
   rings).
5. **Install/replace**: overwrite on a primary (admin login + `fiscal.configure`); re-wrap on a
   mirror (break-glass); refused on a mirror without break-glass; a malformed certificate rejected
   by the `validate` seat **before any write** (assert the vault is unchanged).

Guards to re-run after the schema/registry touches (CLAUDE.md §3): the credentials package's own
suites plus the root `errors-reachable`, `english-only`, and (a new purpose is a credential, not a
`drizzle/` table, so classification is not touched — assert that explicitly rather than assume it).

---

## 8. Out of scope (this slice)

- **Dashboard UI** for `/unlock` and install — API + status field + reworded adopt copy only. The
  promote dashboard UI is already owed separately (Track B item 3 "STILL OWED").
- **Certificate-expiry warnings / proactive renewal reminders.**
- **Automatic primary→standby push of a renewed certificate** — needs a node-to-node public-key
  primitive the repo does not have. Two installs every few years (or a re-adopt) is the accepted
  cost; revisit only if a public-key envelope is introduced for another reason.
- **On-prem full-disk encryption / TPM** — an OS-image concern, decided in
  `2026-08-26-appliance-onboarding-design.md` §9. No code here.
- **Re-admission's certificate cleanup** — when a promoted node is re-admitted as a standby (the owed
  R3 follow-up (b)), it must **delete its live `fiscal.aeat` row** and hold only the dormant copy
  again. That belongs to the re-admission slice; this design adds a one-line note to that backlog
  entry rather than building it here.

---

## 9. What this supersedes

- `2026-08-29-promotion-runbook-design.md` §4–5's "break-glass unlocks the key ring to unseal a
  **replicated** certificate blob" — there was never a replicated certificate to unseal; the standby
  held nothing. This design is the first mechanism that actually puts a (wrapped) certificate on the
  standby. The 08-29 §7 "abort promotion if the certificate cannot be unsealed" is replaced by §3.1
  point 4 (withhold filing, never selling), consistent with sell-now-file-later (#272). Add dated
  pointers to both sections rather than rewriting them (CLAUDE.md §6, historical docs).
- `2026-09-07-promote-endpoint-slice-2-design.md` §4.3's "named dependency: cert distribution to a
  promoted mirror (re-seal `fiscal.aeat` at adopt, or ship it in the bundle)" — this is that
  dependency, resolved as "ship it in the bundle, wrapped under break-glass, sealed dormant."
