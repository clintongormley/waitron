# Identity-config flow-down

**Date:** 2026-08-16
**Status:** implementation-ready spec. Realises the dependency the distribution/client-topology
brainstorm ([`2026-08-15-distribution-and-client-topology-design.md`](2026-08-15-distribution-and-client-topology-design.md),
"#86") named in its §4a/§11 as "its own design, not yet built."
**Decides / scope:** enrol the identity **config** tables (`persons`, `webauthn_credentials`) into
the existing app-level ordered sync lane so they flow **down** to a read-only secondary the way
catalogue already does, and keep the ephemeral auth tables (`sessions`, `management_sessions`,
`webauthn_challenges`) **out**. Thread origin attribution (`nodeId`) through the identity-config
writers. This is the "identity is the gap" piece of failover: after this lands, a secondary can
authenticate the venue's people; session re-establishment stays **PIN-re-prompt v1** (a portable
signed token is a later slice — #86 §4b(ii), out of scope here).

---

## 1. Why this exists — the verified gap (#86 §4)

The #86 design §4 verified the following against the code, and this spec quotes its findings rather
than re-deriving them:

- "**No session table is in the sync set.** The sync lane captures 14 commercial tables
  ([`registry.ts:39-164`](../../../packages/sync/src/registry.ts); count pinned at
  [`registry.test.ts:141`](../../../packages/sync/src/registry.test.ts)), and the **entire
  `identity` package is absent** — `sessions`, `management_sessions`, `persons`,
  `webauthn_credentials` all outside it."
- "**Consequence:** after failover to B, the cookie names a row B has never seen → validation fails
  exactly like a missing cookie. **The cashier is logged out on failover today.**"
- "**Contrast — catalogue config *does* replicate** … So the failover spec's 'config flows down' is
  *partly* built; **identity is the gap.**"

The #86 design split the fix in two, handled oppositely, and this spec implements exactly that split:

> **a. Identity *config* must reach B** … `persons` and their credentials must flow down to B
> read-only, the same way catalogue already does … **likely enrolling the identity config tables in
> the same flow-down lane catalogue uses, excluding the ephemeral `webauthn_challenges`.**
>
> **b. The *session* should NOT replicate.** Replicating session rows fights the grain three ways:
> write amplification (`last_seen_at` bumps every request), it breaks single-writer (the same
> session touched on A then B is two writers to one row, and the table carries **no node/origin
> column**), and the lag tail defeats robustness anyway.

---

## 2. The replicate-vs-exclude decision (the load-bearing table sets)

The `identity` package ships five tenant-scoped tables. Each is classified **config** (deliberate,
low-frequency, admin-authored, needed for B to authenticate) or **ephemeral/session** (hot-path,
per-request or per-ceremony, single-writer-per-session, carries no origin column). The classification
is a per-table property, not a package property.

| Table | Grants (receipt) | Mutability | `updated_at`? | Class | Enrol? |
| --- | --- | --- | --- | --- | --- |
| `persons` | SELECT, INSERT, UPDATE (`0001_identity_rls.sql:20`) | mutable (PIN reset, role change, suspend) | **no** | **config** | **YES** |
| `webauthn_credentials` | SELECT, INSERT, UPDATE, DELETE (`0008_silent_mauler.sql`) | mutable (counter bump) + deletable (revoke) | **no** | **config** | **YES** |
| `sessions` | SELECT, INSERT, UPDATE (`0003_sessions_rls.sql`) | mutable (`ended_at` on logout) | no | ephemeral | **NO** |
| `management_sessions` | SELECT, INSERT, UPDATE (`0006_superb_mojo.sql`) | mutable (`last_seen_at` every request) | no | ephemeral | **NO** |
| `webauthn_challenges` | SELECT, INSERT, UPDATE, DELETE (`0008_silent_mauler.sql`) | ephemeral (consumed/deleted mid-ceremony) | no | ephemeral | **NO** |

### Why each inclusion

- **`persons`** carries the login identity and *the credential material itself* — `pin_hash`,
  `password_hash`, `totp_secret` are columns on `persons`
  ([`schema/persons.ts:40-50`](../../../packages/identity/src/schema/persons.ts)). Without it on B,
  B cannot resolve or verify any user. It is authored on the management dashboard by an admin
  (`createPerson`/`resetPin`/`setPassword`/`setRole`/`suspendPerson`/`reactivatePerson`,
  [`apps/server/src/management-api.ts`](../../../apps/server/src/management-api.ts)) — deliberate,
  low-frequency writes, the same shape as a catalogue edit.
- **`webauthn_credentials`** holds the passkey public keys B needs to verify a WebAuthn assertion,
  and its **DELETE must propagate**: a passkey revoked on the primary must not stay valid on a
  failover target, so revocation is a security-load-bearing part of the flow-down (this is why the
  table's DELETE grant matters — §3).

### Why each exclusion — justified against "sessions must NOT replicate"

- **`sessions`** and **`management_sessions`** are the tables #86 §4b names explicitly. They are
  mutated on the hot auth path (`management_sessions.last_seen_at` on *every request*), so
  replicating them is write-amplification; they are single-writer-per-session (a row touched on A
  then B on failback is two writers to one row) and carry **no node/origin column**
  ([`schema/sessions.ts:11-20`](../../../packages/identity/src/schema/sessions.ts) is keyed to the
  *till*, not the node), so a two-node write is an unattributable single-writer violation; and the
  lag tail means a just-minted session may not have reached B anyway. Re-establishment is PIN
  re-prompt v1 (#86 §4b(i)), not replication.
- **`webauthn_challenges`** is the ephemeral table #86 §4a says to exclude by name. A challenge is
  single-use, consumed by a *locking DELETE at the start of finish*
  ([`schema/webauthn.ts:64-97`](../../../packages/identity/src/schema/webauthn.ts)), lives seconds,
  and `person_id` is null for a discoverable-credential login. Replicating it is pure amplification
  with zero value: the ceremony completes on one node, and a half-finished challenge on B is
  useless. It is single-writer-per-ceremony by construction.

**The exclusion set is exactly "session/ceremony-scoped ephemeral state, mutated on the hot auth
path, with no origin column."** That is the precise reading of #86 §4b's "the session should NOT
replicate," generalised to the three ephemeral tables.

---

## 3. How the two config tables enrol (the registry shape)

Enrolment is one row per table in `ENROLLED` ([`registry.ts`](../../../packages/sync/src/registry.ts))
plus one capture trigger, mirroring how the 14 commercial tables enrol. The commercial set has three
groups (append-only insert-only; mutable-with-`updated_at` watermark; mutable-no-watermark DELETE-capable
"Group C"). The identity config tables are the **no-watermark mutable** shape — neither carries an
`updated_at` column — so they take **Group C's mechanism**: `mode: "watermark-upsert"` with
`watermarkColumn: null`, whose apply is the **unconditional** `DO UPDATE SET <all-non-key-cols>`
([`apply-sql.ts:84-85`](../../../packages/sync/src/apply-sql.ts)), and whose monotonicity rests on
the per-`(subscriber, origin, lane)` **seq cursor**, not a row-level watermark guard.

| field | `persons` | `webauthn_credentials` |
| --- | --- | --- |
| `mode` | `watermark-upsert` | `watermark-upsert` |
| `conflictKey` | `["id"]` | `["id"]` |
| `watermarkColumn` | `null` | `null` |
| `captureOps` | `["insert", "update"]` | `["insert", "update", "delete"]` |
| `fkRank` | `0` (root; FK only to `tenants`, unenrolled) | `1` (FK to `persons`) |
| `lane` | `ordered` | `ordered` |
| capture trigger | `AFTER INSERT OR UPDATE` | `AFTER INSERT OR UPDATE OR DELETE` |

`captureOps` are **grant facts, not intentions** (the registry's stated convention): `persons` holds
no DELETE grant (a person is suspended by flipping `status`, never removed —
`0001_identity_rls.sql:16-20`), so it captures insert+update only; `webauthn_credentials` holds
DELETE (a passkey is revoked outright — `0008_silent_mauler.sql`), so it captures the delete too.

**`persons` extends the registry's group invariant.** Today `registry.test.ts`'s "captureOps match
each table's group" test asserts that a no-watermark mutable table captures *exactly*
`["insert","update","delete"]` — because every such table so far (working_orders, working_order_lines)
holds DELETE. `persons` is the first no-watermark mutable table **without** a DELETE grant, so that
invariant relaxes to: a no-watermark mutable table captures `["insert","update"]`, **plus** `"delete"`
iff it holds the DELETE grant. This is a considered widening of the model, recorded here so a reviewer
sees it is deliberate, not a mistake (CLAUDE.md §1 "before asserting a convention, grep the siblings").

**Why not add an `updated_at` watermark to `persons` instead?** It would make `persons` a clean Group
B watermark-upsert, but it is a schema change plus a burden on every persons writer to bump the column,
and it buys nothing the seq cursor does not already give under the single-writer invariant (§4) — the
exact bet Group C already makes for `working_orders`. CLAUDE.md forbids gold-plating; the no-watermark
Group-C mechanism is the minimal, precedented choice. (If a later slice makes identity config
multi-writer, revisit — see §4.)

### Lane and transport — no transport code changes

Identity config joins the **ordered** lane (it is config, not the payments fast lane). The ordered
lane is already driven end-to-end: the source route maps `?lane=` → `tablesForLane(lane)` server-side
([`apps/server/src/sync-api.ts:111`](../../../apps/server/src/sync-api.ts)), and the pull client
drains the ordered lane ([`pull.ts:100`](../../../packages/sync/src/pull.ts)). Both derive their table
list from `tablesForLane("ordered")`, which is computed from `ENROLLED`
([`registry.ts:190-192`](../../../packages/sync/src/registry.ts)) — so adding the two rows to
`ENROLLED` is the *whole* wiring: `readSyncLogSince`, the wire codec, `applyBatch`, retention, and the
cursor machinery all pick the tables up with **no edit to `pull.ts`, `source.ts`, or `sync-api.ts`**
(grep-verified: those three read the lane's tables only through `tablesForLane`). Retention is
table-agnostic — `pruneSyncLog` deletes already-applied rows by cursor across all tables
([`0001_sync_retention.sql`](../../../packages/sync/drizzle/0001_sync_retention.sql)) — so identity
rows are pruned automatically.

---

## 4. Single-writer-per-row and the read-only secondary

### The invariant this composes with

Waitron's replication is **single-writer-per-row** by design (the "build every feature
single-writer-per-row so it enrols later without a rewrite" principle). Identity config satisfies it:
it is **authored on the PRIMARY only** — the management dashboard is a primary-role surface — so in
normal operation there is exactly **one origin** producing `persons`/`webauthn_credentials` rows. The
seq cursor is per `(subscriber, origin, lane)`, and within one origin apply is strictly seq-ascending
and the cursor never regresses ([`apply.ts:189-223`](../../../packages/sync/src/apply.ts)), so an
unconditional upsert is correct: a later write (higher seq) wins, a re-delivered lower seq is skipped.
This is the *identical* guarantee Group C's `working_orders` already relies on. It holds **exactly as
long as single-writer holds**; if a future slice ever lets identity config be authored on two nodes,
the null-watermark upsert would need an `updated_at` watermark or an origin tiebreak (recorded here so
that decision is not made silently).

### How the secondary stays read-only

The apply path writes each mirrored row as the **ordinary non-superuser `app_user`** under
`withTenant(..., app.sync_apply='on')` ([`apply.ts:298-312`](../../../packages/sync/src/apply.ts)).
This is the sanctioned replication write and — **unlike native logical replication, which is
categorically refused** (`2026-08-02-replication-force-rls-prototype-findings.md`, cited at
[`apply.ts:3-5`](../../../packages/sync/src/apply.ts)) — an app-level write as `app_user` **can** write
into a FORCE-RLS table, because the row's `tenant_id` equals `current_tenant_id()` so the policy's
`WITH CHECK` passes. Catalogue is the working proof of this exact path; identity config reuses it
unchanged.

**What "read-only secondary" means in THIS slice, precisely.** This slice makes identity config *flow
down* correctly (capture on the primary, apply on the secondary) and threads origin attribution. It
does **not** add a database-enforced write-block on the secondary, because there is **no
primary/secondary role distinction in the schema yet** — `nodes` has no `role` column (#86 §14
receipt: "`nodes` has no `role` column yet (primary/secondary deferred)"). The read-only property is
therefore an **application/deployment posture** identical to catalogue's: the management dashboard (the
only writer of identity config) runs against the primary. A secondary running the same binary would,
if a manager pointed a browser at it, accept a local identity-config write — the **same** exposure
catalogue already has, and out of scope to fix here; DB-enforcing it belongs to the deferred
primary-role work (#86 §11 "session-at-target" / failover primary-role). **This is an owner-review
flag (§8), not something this slice invents a `nodes.role` gate for.**

### No apply re-validation hazard

`apply.ts:106-119` flags a transport-slice hazard where re-applying an already-committed row can trip
a **business-rule BEFORE trigger** (tenders/working_orders carry them). `persons` and
`webauthn_credentials` carry **no BEFORE triggers** (grep-verified over
`packages/identity/drizzle/*.sql`: zero `CREATE TRIGGER`), so a re-applied identity upsert is a clean
idempotent no-op and the hazard does not reach them.

---

## 5. Origin attribution — threading `nodeId` through the identity-config writers

For the secondary's per-origin cursor to be correct, a locally-originated identity-config write must
stamp `sync_log.origin_id` with the writing node, not the all-zero sentinel. Capture reads
`app.node_id`, which `withTenant`'s optional 4th arg sets
([`tenancy.ts:48-65`](../../../packages/db/src/tenancy.ts)); a plain 3-arg call leaves the all-zero
default. The commercial writers were retrofitted for exactly this (the "#74/#84 fix B"): the catalogue
route threads `{ nodeId: cfg.nodeId }` into its `withTenant`
([`apps/server/src/catalogue-api.ts:145`](../../../apps/server/src/catalogue-api.ts)), and
`sync-origin.rls.test.ts` guards that the real API call sites pass it.

Identity config is authored **only** in `apps/server/src/management-api.ts`, whose deps currently
carry `cfg: { tenantId: string }` — **no `nodeId`** (`management-api.ts:52`). (`me-api.ts` writes only
workforce/scheduling tables, grep-verified — it needs no change.) This slice adds `nodeId: string` to
`ManagementApiDeps.cfg`, threads `{ nodeId: deps.cfg.nodeId }` into every `withTenant` that wraps an
identity-config write — `createPerson`, `setRole`/`suspendPerson`/`reactivatePerson`, `resetPin`,
`setPassword`, `finishPasskeyRegistration`, and `finishPasskeyAuthentication` (the passkey counter
bump is a `webauthn_credentials` UPDATE that must carry origin too) — and wires `till.nodeId` at the
`mountManagementApi` call site in `boot.ts` (the same `till.nodeId` `mountCatalogueApi` already
receives, `boot.ts:334`; one source of truth, no new config variable).

---

## 6. Migrations

- **One new migration, in `@waitron/sync`:** `packages/sync/drizzle/0003_sync_identity_capture.sql`
  (highest existing sync migration is `0002_sync_cursor_lane`, so the next is `0003`). It creates the
  two capture triggers and nothing else. `@waitron/sync` has **no `drizzle.config.ts`** (its journal
  and snapshots are hand-maintained, and its existing migrations are hand-written "custom" SQL), so
  the change also appends an `idx: 3` entry to `drizzle/meta/_journal.json` and adds a
  `drizzle/meta/0003_snapshot.json` (an empty-tables snapshot chained off `0002`'s, matching the
  existing `0000`–`0002` snapshots — inert at apply time, kept for folder self-consistency).
- **The manifest ordering makes this safe.** `migrations.manifest.json` runs `identity` 2nd and
  `sync` **last** ([`migrations.manifest.json`](../../../packages/migrations/migrations.manifest.json)),
  so when `0003` attaches `CREATE TRIGGER … ON persons` the `persons` table already exists — the same
  reason `0000_sync_outbox.sql` can attach triggers to the commercial tables.
- **No new `identity` migration, no grant change, no RLS change.** `persons` and
  `webauthn_credentials` already carry FORCE ROW LEVEL SECURITY + a tenant-isolation policy + the
  `app_user` grants they need (`0001_identity_rls.sql`, `0008_silent_mauler.sql`), and `app_user`
  already holds `INSERT` on `sync_log` (`0000_sync_outbox.sql:62`), which is the whole grant the
  capture path needs — the trigger runs as the **writing app role** (it is not `SECURITY DEFINER`), so
  the `sync_log` `WITH CHECK (tenant_id = current_tenant_id())` is satisfied by construction because
  the person's `tenant_id` equals the writer's `current_tenant_id()`. There is no FORCE-RLS gap to
  close: both tables are already covered by fiscal-verifactu's `inmutabilidad` FORCE-RLS scan (the
  `0003`/`0006`/`0008` RLS migrations each cite it), and this slice adds **no new tenant-scoped
  table**, so that guard needs nothing new.
- **The generic capture function is reused, not re-created.** Both triggers `EXECUTE FUNCTION
  sync_capture()` — the one function `0000_sync_outbox.sql:126` already defines, which branches on
  `TG_OP`, reads `app.node_id` for the origin, and writes the `to_jsonb(row)` image.

---

## 7. Fiscal safety (H2)

**Claim: identity is auth-only and touches nothing in the fiscal core, and this slice enrols no
fiscal table.** Receipts (grep-verified 2026-08-16):

- `grep -rin "huella|registros_facturacion|computeHuella|secuencia|invoice_series|next_number"
  packages/identity/src` → **zero matches.** Identity references nothing in the hash chain, the
  immutable `registros_facturacion` table, or invoice numbering.
- `grep -rln "computeHuella" packages` → the importers are all `fiscal-verifactu`, `verifactu`,
  `reporting`, `workforce`, and `packages/db/src/order-amendment-hash.ts` — **never `identity`.**
- `grep -rin "@waitron/identity|persons|webauthn"
  packages/fiscal-verifactu/src packages/verifactu/src` (non-test) → **zero matches.** The fiscal
  packages never reference identity, so enrolling identity cannot pull a fiscal table into the sync
  set.
- The sync capture set touched by this slice is `persons` + `webauthn_credentials` only. The fiscal
  lane (`registros_facturacion`, `envios`) is **deliberately absent** from `@waitron/sync` and stays
  absent — `registry.test.ts`'s `[a-z_]+` guard already refuses any Spanish fiscal token in an
  enrolled name, and both new names pass it as English identifiers.
- The two new triggers fire only on `persons`/`webauthn_credentials`; neither table is fiscal, and
  `computeHuella` reads neither. **This slice cannot alter a hash, a chain, a `registros_facturacion`
  row, or an invoice number** — none of the fiscal invariants in CLAUDE.md §5 are in reach.

This is an **H1** change (no fiscal surface). The fiscal lane remains owner-reviewed separately
(#86 §12), untouched.

---

## 8. Security note — replicating credential material

Flowing credential material to a second box is a real exposure surface and is reasoned about
explicitly here rather than waved through.

- **The secondary is a Waitron-controlled local server** — the venue's own on-prem box (or its
  dedicated single-tenant cloud instance), in the **same trust domain** as the primary (#86 §6). So
  replicating credentials to it does not cross a trust boundary the primary was not already inside;
  it increases the *number of boxes* holding the material, from one to two.
- **`pin_hash` / `password_hash` are salted scrypt hashes**, never plaintext
  ([`schema/persons.ts:38-40`](../../../packages/identity/src/schema/persons.ts),
  `verify-pin.ts`/`verify-password.ts`). Replicating a hash is materially lower-risk than plaintext;
  a mirror leak yields hashes, not passwords.
- **`totp_secret` is stored PLAINTEXT base32** — it must be recoverable to verify a rolling code, so
  it cannot be hashed ([`schema/persons.ts:42-50`](../../../packages/identity/src/schema/persons.ts)).
  That same comment carries a **DEFERRED debt item**: "the enrollment slice MUST encrypt `totp_secret`
  at rest via the credentials vault (AES-256-GCM) …". Flow-down would **double** the number of boxes
  holding a plaintext TOTP secret in the clear.
  - **Mitigating fact, verified:** `schema/persons.ts:45` states "nothing writes it yet (TOTP
    enrollment is a later slice; only tests set it via raw SQL)." So in the current tree
    `totp_secret` is **always NULL** on every production write. Replicating an always-NULL column adds
    **no real exposure today**.
- **`webauthn_credentials.public_key`** is, by name, public key material — not a secret. Its capture
  (including the per-login counter bump) exposes nothing new; the counter-bump UPDATE is minor
  write-amplification, per *login* (low frequency), unlike the per-*request* session bump that made
  `management_sessions` an exclusion.

**Decision:** this slice **proceeds** and does **not** block on the TOTP at-rest-encryption item,
because `totp_secret` is unwritten today so flowing the (NULL) column down changes nothing. It
**hard-flags** (§9) that the TOTP-enrollment slice inherits a dependency: it must land at-rest
encryption of `totp_secret` **before** it writes the column, precisely because this flow-down now
multiplies the exposure. Recording the flag is the deliverable; enrolling `persons` (structurally
including the column) is safe as long as the column stays NULL.

---

## 9. Owner-review assumptions

A fresh executor lands the mechanical work below without pause, but must leave the PR
**`needs-owner-review`** (do **not** auto-land) if any of these is in play:

1. **Credential-secret replication vs the at-rest-encryption debt.** This slice is safe *only while
   `totp_secret` is unwritten* (§8). If the executor's change also begins writing `totp_secret`
   (i.e. the TOTP-enrollment slice is folded in), that is a decision to replicate plaintext TOTP
   secrets to a second box — flag it and stop; it needs the AES-256-GCM at-rest encryption first.
2. **Read-only-secondary enforcement mechanism.** This slice does not DB-enforce a secondary
   write-block (§4); it inherits catalogue's app-layer posture because no `nodes.role` exists. Adding
   a database-enforced secondary write-block is a product/security decision belonging to the deferred
   primary-role work — do **not** invent a `nodes.role` gate here; if tempted, flag for owner review.
3. **Guardrail (CLAUDE.md-aligned):** on any drift into the fiscal core, or any unrecorded
   security/product decision beyond the two above, leave the PR `needs-owner-review` and do not land.

Everything else — the registry rows, the capture migration, the apply/boundary tests, the `nodeId`
threading — is mechanical and lands normally.

---

## 10. What this does NOT do (scope boundary)

- **No session replication** and no portable signed token (#86 §4b(ii)) — session re-establishment
  stays PIN re-prompt v1, owned by the failover/client-routing work, not this slice.
- **No `nodes.role` / primary-role gate** — read-only-secondary stays an app-layer posture (§4).
- **No transport/redelivery changes** — the ordered lane's transport already carries the new tables
  (§3); this slice does not touch `pull.ts`/`source.ts`/`sync-api.ts`.
- **No fiscal lane** — untouched (§7).
- **No backwards-compat / data-migration code** — nothing is deployed; schema builds fresh
  (CLAUDE.md §3). There is no identity data to backfill.

---

## 11. Consumers to update (the complete edit surface)

| File | Change |
| --- | --- |
| `packages/sync/src/registry.ts` | add the two `ENROLLED` rows (§3) |
| `packages/sync/src/registry.test.ts` | count 14→16; ordered partition 12→14; add the two `SPEC` rows; relax the group invariant; add the `persons`→`webauthn_credentials` fkRank pair |
| `packages/sync/src/apply-sql.ts` | add `persons` + `webauthn_credentials` to `SYNC_SCHEMA_TABLES`, deep-importing them from `@waitron/identity/src/schema/index.js` (mirroring the payments schema deep-import already in the file; avoids pulling identity's auth runtime into `@waitron/sync`) |
| `packages/sync/package.json` | add `"@waitron/identity": "workspace:*"` dependency (+ lockfile) |
| `packages/sync/drizzle/0003_sync_identity_capture.sql` (new) | the two capture triggers |
| `packages/sync/drizzle/meta/_journal.json` | append `idx: 3` |
| `packages/sync/drizzle/meta/0003_snapshot.json` (new) | empty-tables snapshot chained off `0002` |
| `packages/sync/src/capture-identity.gate.test.ts` (new) | the replicate/exclude boundary, real-PG, prove-by-deletion |
| `packages/sync/src/apply.gate.test.ts` (extend) or new `apply-identity.gate.test.ts` | apply a `persons` row + a `webauthn_credentials` delete under FORCE RLS; idempotent; cross-tenant fenced |
| `packages/sync/src/origin.gate.test.ts` (extend) | a `persons` write via 4-arg `withTenant` stamps origin; plain leaves ZERO |
| `apps/server/src/management-api.ts` | `cfg.nodeId` + thread `{ nodeId }` into the identity-config `withTenant` calls |
| `apps/server/src/boot.ts` | pass `till.nodeId` to `mountManagementApi` |
| `apps/server/src/sync-origin.rls.test.ts` (extend) | a `createPerson` HTTP write captures `origin_id = cfg.nodeId`; prove-by-deletion |
| `docs/.../2026-08-15-distribution-and-client-topology-design.md` | dated pointer: §4/§14's "14 commercial / identity absent" is now "16 enrolled; identity **config** flows down" (CLAUDE.md §6 — pointer, not rewrite) |

Load-bearing count comments inside `@waitron/sync` that say "14/fourteen" describe the **commercial**
lane specifically; frame the change as "14 commercial + 2 identity-config = 16 enrolled (14 ordered +
2 fast)" and update the count in the comments that describe the *enrolled* total, leaving the ones
that describe the *commercial* subset accurate.

---

## 12. Code-state receipts (internal)

Re-checkable facts this design rests on:

- **Manifest orders `identity` 2nd, `sync` last** — `packages/migrations/migrations.manifest.json`.
- **`@waitron/sync` does not yet depend on `@waitron/identity`** — `packages/sync/package.json`
  `dependencies` = `db`, `payments`, `shared`, `drizzle-orm`, `pg`. The barrel already exports the
  schema objects (`@waitron/identity` index.ts:24-27 exports `persons`, `webauthnCredentials`), so the
  import is from the package root, not a deep path.
- **`@waitron/sync` has no `drizzle.config.ts`** (journal + snapshots hand-maintained); `@waitron/identity`
  has one. Highest sync migration = `0002_sync_cursor_lane`.
- **The generic `sync_capture()` reads `app.node_id` and branches on `TG_OP`** —
  `packages/sync/drizzle/0000_sync_outbox.sql:126-146`; `app_user` holds `INSERT` on `sync_log`
  (`:62`).
- **Ordered lane is driven only through `tablesForLane`** — `apps/server/src/sync-api.ts:111`,
  `packages/sync/src/pull.ts:100`; nothing hardcodes the table list.
- **`persons`/`webauthn_credentials` carry FORCE RLS + tenant policy + grants** —
  `0001_identity_rls.sql`, `0008_silent_mauler.sql`; **no BEFORE triggers** on either
  (`grep CREATE TRIGGER packages/identity/drizzle/*.sql` → none).
- **`totp_secret` is plaintext and currently unwritten** — `packages/identity/src/schema/persons.ts:42-50`.
- **Identity config is authored only in `management-api.ts`; its `cfg` lacks `nodeId`** —
  `apps/server/src/management-api.ts:52`; the writer call sites are `management-api.ts:312/365/368/371/394/416/564/612`.
  `me-api.ts` writes only workforce tables.
- **The catalogue origin-attribution precedent** — `apps/server/src/catalogue-api.ts:145`,
  proven at `apps/server/src/sync-origin.rls.test.ts`.
</content>
</invoke>
