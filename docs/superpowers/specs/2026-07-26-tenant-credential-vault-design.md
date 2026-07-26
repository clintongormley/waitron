# The tenant credential vault — `packages/credentials`

**Date:** 2026-07-26
**Status:** design, approved in brainstorm; implementation plan to follow.
**Main at design time:** `c9faa2c`.

## 1. Why this exists

Every adapter in this repo was built **config-agnostic on purpose**, and each one reads its
credentials from an injected seam rather than fetching them:

| Seam | Package | What its own comment says |
| --- | --- | --- |
| `StripeReconcilerOptions.resolveAccount(tenantId)` | `payments-stripe` | *"provisioning stays deferred"* |
| `stripeHostedClient(stripe, config)` | `payments-stripe` | *"`config` is deployment-injected (SP7/SP9)… Provisioning them is out of scope here"* |
| `StripeTerminalProviderOptions.resolveReader` | `payments-stripe` | reader provisioning deferred |
| `ClientOptions.fetch` | `verifactu` | *"Client-certificate material is supplied by the caller's fetch… certificate handling is a deployment concern"* |

Four packages deferred the same thing to the same place. This is that place.

The immediate trigger is that the `apps/*` host (sub-project C) cannot do anything real without
credentials: `verifyAndParse` needs a signing secret, `resolveAccount` needs a Stripe key, and
`drain` needs certificate material for mTLS. The host was going to have to invent this subsystem
inline; designing it first keeps that from happening in passing.

**This design covers the vault only. It ships no consumer** — see §8.

## 2. The decisions this design rests on

Taken in the brainstorm, recorded so a later reader can see they were choices:

1. **Multi-tenant from the start.** Per-tenant credentials, resolved per tenant, not a single
   global set. Architecture §8: each tenant has its own NIF, series, certificate and independent
   chain, so there was never a single-credential deployment to grow out of.
2. **Encrypted in the database, not in deployment config.** Chosen over a config file keyed by
   tenant, in full view of the tradeoff: it puts a tenant's qualified fiscal certificate in the
   application's own database rather than in the operator's secret manager. §3 is the mitigation,
   §4 the residual risk.
3. **Decryption happens in Node, never in Postgres.** `pgcrypto` would carry the master key as a
   bound parameter into `pg_stat_statements`, server logs, and any query-log capture. The key must
   never enter SQL.
4. **One master key from the environment, plus a `key_version` column.** Not envelope encryption:
   a key hierarchy buys rotation-without-re-encryption, and at a few dozen rows re-encrypting
   everything is a single cheap pass. Not a KMS interface: one interface with one implementation is
   the dead surface this project's own rules reject (`packages/fiscal`'s `backend.ts`).
5. **The vault knows purpose names and field lists as data; it imports nothing.** So the CLI
   rejects a typo'd field at provisioning time rather than at 3am as a webhook signature failure.

## 3. Package shape

`packages/credentials` (`@waitron/credentials`). Depends on `@waitron/db`, `@waitron/shared` and
`drizzle-orm` only, plus `node:crypto`. It owns its own table, its own `CREDENTIALS_MIGRATIONS` descriptor and its
own `schema-ownership.test.ts` — the `packages/payments` / `packages/scheduler` precedent. Core
migrations run first (the `tenants` foreign key).

### Why not in the packages that use the credentials

The repo's rule is *each package owns its own tables*, which reads as an argument for Stripe
credentials living in `packages/payments-stripe` and the AEAT certificate in
`packages/fiscal-verifactu`. That is the wrong read here, and §1's table is why: if an adapter
started reading its own credentials from a table, the injected seam inverts and every one of those
four comments becomes false. The adapters stay config-agnostic; **credentials are deployment data,
not domain data**, and only the host imports this package.

It also avoids duplicating the crypto and the key handling into two packages, or growing a shared
crypto package that would leave the vault split across three places.

### `packages/db`'s `english-only.ts` enumerates `GENERIC_PACKAGES` explicitly

A new package silently escapes that guard until it is added. Adding `"credentials"` to that list is
part of this work, not a follow-up — the `packages/scheduler` cycle learned this the expensive way
(a pinned source-text regex sat red for six tasks).

## 4. The table

```text
tenant_credentials
  tenant_id    uuid         not null references tenants(id)
  purpose      text         not null            -- 'payments.stripe', 'fiscal.aeat'
  ciphertext   bytea        not null            -- AES-256-GCM over the JSON payload
  iv           bytea        not null            -- 12 bytes, fresh per write
  auth_tag     bytea        not null
  key_version  int          not null
  updated_at   timestamptz  not null
  primary key (tenant_id, purpose)
```

`FORCE ROW LEVEL SECURITY` with the standard tenant-isolation policy, like every other tenant-keyed
table in this repo.

### The AAD is the part worth arguing for

The additional authenticated data is `tenant_id || purpose`, which **binds a ciphertext to the row
it belongs in**. Someone with write access to the database cannot move tenant B's encrypted Stripe
credentials into tenant A's row and have the host decrypt them: the associated data no longer
matches and authentication fails.

Without it, that swap succeeds silently and tenant A begins settling against tenant B's Stripe
account — real money, wrong merchant, no error anywhere. Encryption alone does not prevent this,
because the attacker never needs to read the plaintext to carry it out. Only binding does.

### Key loss, and why the two purposes are not equivalent

Losing the master key makes every stored credential unrecoverable. What that costs differs sharply:

- A **Stripe secret key** is re-issued from the dashboard in a minute.
- An **AEAT qualified certificate** is *days to weeks*
  ([getting-to-production.md §1](../../compliance/getting-to-production.md)) — four sequential FNMT
  phases, with a mandatory ~1-hour wait before download, so it cannot even be done in one sitting.
  For a tenant already trading, that is an interruption of a legal obligation, not an inconvenience.

Therefore: **the vault is explicitly not the system of record for the certificate.** The operator
keeps the original `.p12` in offline custody and the vault holds a working copy. This is an
operational invariant that belongs in the deployment documentation, not a property code can enforce.

### The certificate payload shape is provisional

Whether an FNMT *sello de entidad* certificate can be exported for unattended server use at all is
listed as unverified — *"a certificate that cannot leave a browser or a hardware token is unusable
for an unattended server"* (getting-to-production.md §4). Because the payload is an opaque JSON blob,
learning the real answer changes a type in the host, not a migration here. That is a deliberate
benefit of the blob, not an accident of it.

## 5. The surface

```ts
// The key ring, built once from the environment. Every read and write takes it.
loadKeyRing(env): KeyRing                                                    // validates eagerly

// Read — tenant-scoped, inside withTenant, decrypted in Node.
getCredential(tx, ring, ref): Promise<Record<string, string>>                // throws credentials.missing
tryGetCredential(tx, ring, ref): Promise<Record<string, string> | null>      // null ONLY when no row

// Write — the CLI, and tests.
putCredential(tx, ring, { tenantId, purpose, value }): Promise<void>         // validates the field list
deleteCredential(tx, ref): Promise<boolean>                                  // false when there was none
listCredentials(tx): Promise<CredentialMeta[]>                               // metadata only
rotateCredentials(db, ring): Promise<RotationResult>

// Cross-tenant enumeration — untenanted, SECURITY DEFINER.
credentialTenants(db, purpose): Promise<TenantId[]>                          // [] when unprovisioned

// Data, not imports: purpose names and their required fields.
PURPOSES: Record<string, readonly string[]>
```

> **Corrected 2026-07-26 (final review).** This block was written before implementation and drifted
> in three ways, all of them improvements the code made and the doc did not record. `ring` is
> threaded explicitly rather than `tenantId`/`purpose` positionally, because the ring is what
> selects a key by the row's own `key_version`; `deleteCredential` returns a **boolean** so the CLI
> can distinguish "de-provisioned" from "there was nothing there"; and `loadKeyRing`,
> `listCredentials` and `rotateCredentials` were always part of the surface but were never listed.

**`tenantId` is a parameter even though RLS already scopes the read**, matching how every other
store function in this repo is written (`readSnapshot(tx, { tenantId, … })`). It is also the AAD
input (§4). Precisely what the AAD catches is worth stating, because it is narrower than it first
looks: the AAD is *not stored*, it is recomputed from the row's own identity at read time, so what
fails is a **ciphertext that was written under a different `(tenant, purpose)` and later moved** —
not a mismatch between the caller and the row, which RLS has already made impossible.

**No caching; read per use.** A cache holds plaintext secrets in RSS for the life of the process and
goes stale the moment the key rotates. The decrypt is one AES call against a row Postgres already
has in shared buffers.

**The returned `Record<string, string>` is mapped to each adapter's typed options by the host**, not
here. That is what keeps this package free of provider vocabulary while still validating on write.

### `credentialTenants` is the third instance of an established pattern

`tenants` is `FORCE ROW LEVEL SECURITY` with a tenant-isolation policy, so enumerating tenants
cross-tenant needs a controlled bypass. Two already exist and this one is a deliberate clone rather
than a fresh invention:

- `envios_tenants_with_work` (fiscal migration `0004`) — the drainer's tenant enumeration;
- `resolve_payment_tenant` (payments, Mode 3 Slice A) — the untenanted webhook lookup.

Same construction: a `NOLOGIN NOSUPERUSER` role owning a `SECURITY DEFINER` function with
`SET search_path = pg_catalog, public`, a **permissive** `FOR SELECT … USING (true)` policy for that
role alone (Postgres ORs permissive policies, so tenant isolation is untouched for every other
role), `REVOKE EXECUTE … FROM PUBLIC`, `GRANT EXECUTE … TO app_user`. Deliberately **not** a
`BYPASSRLS` role: that requires the grantor to already hold `BYPASSRLS`, which the hardened
migration role does not — verified live by both predecessors.

It returns **only uuids**, never a ciphertext column, holding to the same principle both
predecessors state: the bypass surface is one uuid. A hand-written `--custom` migration, since
drizzle-kit can express none of it.

**A useful consequence:** a tenant with no credential for a purpose is not enumerated for it, so the
vault *is* the enrolment list for that duty. The host needs no separate concept of "which tenants
are configured for Stripe".

## 6. The CLI

`packages/credentials` gains a `bin`, driven by `node:util`'s `parseArgs` — no argument-parsing
dependency, consistent with how lean this repo's manifests are.

```text
waitron-credentials set    --tenant <uuid> --purpose <name> [--file <path>]   # payload on stdin by default
waitron-credentials list   [--tenant <uuid>]        # tenant, purpose, key_version, updated_at
waitron-credentials rotate                          # re-encrypt every row: previous key -> current
waitron-credentials delete --tenant <uuid> --purpose <name>
```

Three rules, enforced by tests as behaviour rather than left as convention:

- **The secret never appears in `argv`** — stdin or `--file` only. `argv` is world-readable in `ps`
  and lands in shell history.
- **There is no `get`.** Nothing prints a decrypted credential; `list` shows metadata only. An
  operator who needs to verify a value re-provisions it.
- **`rotate` reads `WAITRON_CREDENTIALS_KEY_PREVIOUS` and writes with `WAITRON_CREDENTIALS_KEY`**,
  per row, in one transaction, bumping `key_version`. Both keys are present only during the
  rotation window.

### The key ring, and why `key_version` earns its column

`WAITRON_CREDENTIALS_KEY` is 32 bytes, base64-encoded, supplied by the operator's secret manager.
This package is a library and has no startup of its own, so the key is read and validated once, when
a caller builds the key ring — a missing or malformed key fails there, with a structured error,
rather than at the first decrypt of the first credential. The host (sub-project C) builds it during
boot, which is what turns that into a startup failure for the process.

A version number cannot be derived from a key, so it is supplied alongside it:

| Variable | Required | Meaning |
| --- | --- | --- |
| `WAITRON_CREDENTIALS_KEY` | yes | current key, base64, 32 bytes |
| `WAITRON_CREDENTIALS_KEY_VERSION` | no, defaults to `1` | the version stamped on rows written now |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS` | only while rotating | the key being retired |
| `WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION` | required when `_PREVIOUS` is set | its version |

**Reads select the key by the row's own `key_version`**, rather than assuming the current one. That
is what makes `key_version` load-bearing instead of decorative: a `rotate` interrupted half-way —
killed process, lost connection, full disk — leaves some rows on the old version and some on the
new, and the vault keeps serving *both* as long as the ring carries both keys. Re-running `rotate`
finishes the job. Without the per-row version, a partial rotation is an outage.

### Packaging: this package is built, and the repo has never built anything

Verified while planning: Node does not resolve a `.js` import specifier to a `.ts` file, this repo
writes `.js` specifiers throughout, and every package's `main` points at TS source with no build
step — `pnpm build` is a no-op because no package defines one. So a `bin` cannot run against the
source layout, and compiling only this package does not help either: the output still imports
`@waitron/db`, whose `main` is `./src/index.ts` and whose own internal specifiers fail identically.

The CLI is therefore **bundled with esbuild** into a self-contained `dist/bin.js`, with
`@waitron/db`, `@waitron/shared` and `drizzle-orm` inlined. One devDependency, in this package only:
no other manifest changes, so `main: ./src/index.ts` and the whole existing test suite are
untouched. Rejected alternatives were adding `build` scripts and `exports` conditions across
`shared`/`db`/`credentials` (correct, scales to every future app, but cross-cutting enough to break
typecheck repo-wide for what is meant to be a leaf cycle) and shipping `tsx` as the operator's
runtime (a dev loader in production, and not a self-contained artifact).

**This is the packaging path sub-project C inherits.** A bundled long-running process is an ordinary
artifact for a self-hosted deployment, so the host reuses this rather than solving it again.

## 7. Testing

The money is in the crypto and the RLS, so that is where the coverage goes.

- **The AAD test has teeth.** Take a valid row, move its ciphertext to another `(tenant, purpose)`,
  assert decryption *fails*. Deleting the AAD from the implementation must turn this red — that is
  the entire reason the AAD exists, and a test that cannot fail is the defect class the last three
  cycles kept finding.
- Tampered ciphertext fails (GCM auth tag); the wrong key fails; a `fast-check` property test for
  round-trip over arbitrary payloads — `packages/verifactu` is the repo's only current user of
  `fast-check`, so this adds it as a devDependency here rather than inheriting one.
- **Real Postgres for RLS** — the PGlite-can't-cover case, exactly as both predecessor seams are
  proven: tenant A cannot read tenant B's row under a genuine non-superuser `app_user`; a plain
  `select` with no GUC set returns nothing; `credentialTenants` crosses tenants and returns uuids
  only. PGlite's superuser connection bypasses RLS and would hide every one of these.
- The new `*.rls.test.ts` writes its **own** guarded `afterAll` rather than inheriting the
  unconditional one that masks a `beforeAll` failure and leaks the container.
  `packages/scheduler`'s two real-Postgres suites are the shape to copy.

  > **Corrected twice, 2026-07-26.** This first read "the four `packages/payments` files",
  > inherited from the scheduler handoff; the Task 4 review corrected it to seven across two
  > packages; the final whole-branch review found that was still short. **The real figure is TEN
  > unconditional teardowns across THREE packages, among `*.rls.test.ts` files** — verified by
  > reading every `afterAll` in every `*.rls.test.ts` file in the repo, the scope this table has
  > always meant:
  >
  > | Package | Unconditional | Files |
  > | --- | --- | --- |
  > | `packages/payments` | 3 | `payment-policy`, `payments`, `reconcile` |
  > | `packages/payments-stripe` | 4 | `device`, `hosted`, `reconcile`, `stripe` |
  > | `packages/fiscal-verifactu` | 3 | `acks`, `pending-count`, `reconcile` |
  >
  > Only `packages/scheduler` and `packages/credentials` are guarded. The per-package breakdown is
  > given rather than a bare total precisely because a bare total has now been wrong twice, and each
  > time someone would have fixed a subset and believed they were done.
  >
  > **Not counted above, and not fixed by anything in this cycle:** `*.concurrency.test.ts` files
  > share the identical unconditional-`afterAll` pattern against a real Postgres container, and are
  > a DIFFERENT set of files from the `*.rls.test.ts` table above — seven more, found while
  > verifying this correction: `packages/payments` (5: `async-settle`, `forward`,
  > `incident-dedup`, `reconcile`, `reversal`) and `packages/fiscal-verifactu` (2: `chain`,
  > `drain`). `packages/scheduler`'s own `store.concurrency.test.ts` is the one such file that IS
  > guarded. Whoever picks this up next should treat it as its own count, not a missed row in this
  > table.
- **Rotation:** a rotated row reads with the new key and its `key_version` advanced; and — the test
  that justifies the column — a vault holding one rotated and one un-rotated row serves **both**
  while the ring carries both keys, which is the interrupted-`rotate` case.
- **CLI:** the payload is read from stdin/`--file` and never from `argv`; `list` output contains no
  plaintext; `set` rejects an unknown purpose and a payload with a missing or unexpected field.
- Mutation-test every guard before committing — break it, observe RED, restore, observe GREEN. The
  scheduler cycle found a predicate with no failing test in five consecutive task reviews, and the
  two tasks that broke the streak were the two whose implementers did this.
- Run `pnpm -r test`, not just this package's gate: Task 1 touches `packages/db`'s
  `english-only.ts`, and a per-package gate cannot see what that breaks elsewhere.

## 8. Out of scope

- **Nothing reads this vault.** The same honest cost the scheduler carried: sub-project C is its
  first consumer, and this cycle ends with a provisionable vault and no host.
- **The HTTP admin endpoint.** Deferred until identity (sub-project 5) exists to authenticate it;
  shipping it now would mean inventing a bearer-token scheme that sub-project 5 replaces.
- **Rotation without downtime.** `rotate` is a maintenance-window operation.
- **Per-credential access audit**, and **HSM / KMS custody** — decision 4.
- **`DueAtDuty`** (sub-project B) and the **`apps/*` host** (sub-project C).

## 9. Rejected alternatives

**Deployment config keyed by tenant** — a file or env mapping `tenantId → credentials`. Fully
multi-tenant, no table, no encryption, no key management, and it keeps secrets in the operator's
secret manager where a self-hosted deployment's secrets normally live. Rejected in favour of
decision 2: a database row is provisionable later through a dashboard without a redeploy, and the
tenant list comes from the same place as the credentials.

**Per-domain credential tables** — `payments-stripe` owns its Stripe credentials,
`fiscal-verifactu` owns the certificate. Matches the repo's table-ownership rule most literally, and
rejected for §3's reason: it inverts the injected seam four packages deliberately built.

**Envelope encryption** and a **KMS interface** — decision 4.

**`pgcrypto`** — decision 3.

**Repo-wide `build` scripts with `exports` conditions**, and **`tsx` as the operator's runtime** —
see §6's packaging note.
