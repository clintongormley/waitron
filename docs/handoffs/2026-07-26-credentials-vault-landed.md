# Handoff — the tenant credential vault landed

**Date:** 2026-07-26
**Type:** *Backward-looking* — what shipped, why it is shaped this way, and what is genuinely left.
**Main at handoff:** `9e85d8a`.

| PR | Squash | What |
| --- | --- | --- |
| #33 | `9e85d8a` | **`packages/credentials`** — a per-tenant encrypted credential store |

Spec: [`2026-07-26-tenant-credential-vault-design.md`](../superpowers/specs/2026-07-26-tenant-credential-vault-design.md).
Plan: [`2026-07-26-tenant-credential-vault.md`](../superpowers/plans/2026-07-26-tenant-credential-vault.md).
Both were kept current as review changed them — read the spec before the plan.

---

## 1. What this is, in one idea

**Four packages deferred the same thing to the same place.** `StripeReconcilerOptions.resolveAccount`,
`stripeHostedClient(stripe, config)`, `StripeTerminalProviderOptions.resolveReader` and
`ClientOptions.fetch` each carry a comment saying provisioning is deliberately not owned there. This
is that place.

It is deliberately **not inside any of them**. The repo's rule is that each package owns its own
tables, which reads as an argument for Stripe credentials living in `packages/payments-stripe` and
the certificate in `packages/fiscal-verifactu`. That is the wrong read: every adapter was built
config-agnostic on purpose, and an adapter that fetched its own credentials would invert the
injected seam those four comments exist to protect. **Credentials are deployment data, not domain
data.**

## 2. How one task became three sub-projects

The starting point was "the `apps/*` host". Two decisions turned it into three cycles:

1. **Multi-tenant from the start** — per-tenant credentials, not one global set. Architecture §8
   already implies it: each tenant has its own NIF, series, certificate and chain.
2. **Encrypted in the database**, not in deployment config — chosen in full view of the tradeoff
   that it puts a tenant's qualified fiscal certificate in the application's own database.

Together those summoned a credential subsystem that did not exist before, and it is a leaf with no
dependencies, so it went first.

| | Sub-project | State |
| --- | --- | --- |
| **A** | Tenant credential vault | **landed, this PR** |
| **B** | `DueAtDuty` in `packages/scheduler` | not started; independent of A |
| **C** | `apps/server` — webhook endpoint, orchestration, scheduler loop, mTLS client, lifecycle | not started; needs A and B |

**Nothing consumes the vault yet.** Same honest cost `packages/scheduler` carried: C is its first
consumer.

## 3. The decisions worth knowing before you touch it

**The AAD is the load-bearing security property.** It binds a ciphertext to `tenant_id || purpose`,
so someone with database *write* access cannot move tenant B's sealed Stripe credentials into tenant
A's row and have them decrypt. Without it that swap succeeds silently and tenant A settles against
tenant B's account — real money, wrong merchant, no error anywhere. The attacker never needs to read
plaintext, which is exactly why encryption alone does not stop it. Only binding does.

**`key_version` is what makes rotation survivable.** Reads select their key by the *row's* own
version, never the ring's current one. A `rotate` killed half-way therefore leaves a readable vault
that re-running finishes, instead of an outage. That property is what justifies the column.

**Decryption happens in Node, never Postgres.** A key handed to `pgcrypto` travels as a bound
parameter into `pg_stat_statements`, server logs, and any query-log capture.

**One master key plus a `key_version` column** — not envelope encryption (a key hierarchy buys
rotation-without-re-encryption, worthless at a few dozen rows) and not a KMS interface (one
interface with one implementation is the dead surface this project rejects).

**Purposes are data, not imports.** `PURPOSES` holds field *names* as strings, so the package never
learns what a Stripe key is. An eslint zone enforces the boundary — and that zone was added only
after a reviewer proved a relative-path import into `packages/payments` linted clean while a comment
claimed otherwise.

**This is the first package in the repo with a `build` step**, and the reason is verified rather than
assumed: Node does not resolve a `.js` specifier to a `.ts` file, this repo writes `.js` specifiers
throughout, and compiling this package alone does not help because the output still imports
`@waitron/db`'s TS source. esbuild bundles the CLI into a self-contained `dist/bin.js`. **Sub-project
C inherits this packaging path.**

**`rotate` is a maintenance-window operation.** Concurrent-write safety is deliberately absent — see
§4.

## 4. Three things the reviews changed that a reader would not guess

**A raw `0x00` byte in the plan corrupted every brief extracted from it.** `aadFor`'s NUL separator
was authored as a literal control character. That made `file(1)` report the plan as `data`, made
`grep` treat it as binary, and truncated the extracted task brief mid-template-literal. The
implementer reconstructed the intent correctly from the surrounding doc comment and flagged it; the
plan is fixed. **Any control character written into a plan silently corrupts every brief derived
from it** — check `file(1)` on a brief that looks truncated.

**The shared-transaction concurrency claim was false.** `rotateCredentials` shares one `withTenant`
transaction for its read and re-write, and the plan justified that by claiming it stops a concurrent
`set` being overwritten. It does not: `withTenant` is a plain `db.transaction()` at READ COMMITTED,
the SELECT takes no row lock, and the UPSERT's `SET` values are app-computed constants, so the lost
update is identical whether the gap spans one transaction or two. Only `SELECT … FOR UPDATE`, or
REPEATABLE READ / SERIALIZABLE plus a retry loop, would prevent it — and **the shared transaction is
a necessary precondition for all three and sufficient for none**. The shape was right; the reason was
invented. The comment now says so.

**`--admin` was not needed to merge.** Prior memory said branch protection blocks twice in this solo
repo and only `--admin` gets through. With every Copilot thread resolved first, plain
`gh pr merge --squash` succeeded on the first try. Resolving conversations appears to be the gate
that actually bites.

## 5. Defects found, and by what

Same tradition as the last three slices. **None of the following were found by a green suite.**

| Defect | Found by |
| --- | --- |
| The **base64 master key** printed to stderr on a plausible operator typo — `key_version_invalid` carried the raw env value, and `bin.ts` prints params | **Final whole-branch review** (seven task reviews missed it) |
| Deleting `ALTER FUNCTION … OWNER TO` left all 6 tests green while making the `SECURITY DEFINER` function run as **superuser** — an unrestricted RLS bypass | Task 4 review |
| `JSON.parse` embeds its input in the `SyntaxError` it throws — a decrypted Stripe key in an error message | Task 3 review |
| `open()` could throw: `createDecipheriv`/`setAuthTag` sat outside the `try`, so a tampered row escaped as a raw crypto string | Task 2 review |
| The upsert's `key_version` refresh had no failing test — re-provisioning after a rotate would seal under the new key and stamp the old version | Task 3 review |
| The `DELETE` grant had no failing test, including in the real-Postgres suite | Final review |
| A comment citing a test that **does not exist**, to support a property that is not real | Task 6 review |
| `set`'s payload shape guard: two of three operands untested; dropping `parsed === null` makes `runCli` **reject** instead of returning an exit code | **Fresh-context review, after `/finish-branch`** |
| `captured()` duplicated across four test files — the plan itself specified a fresh local copy in three separate task write-ups | **`simplify`** |

**Three patterns worth carrying forward.**

*First:* **seven of these trace to the plan text, not to an implementer.** The failure mode is
consistent — asserting a causal property that reads plausibly and only fails when someone runs it.
Five were defective mutation checks: I described what to break without verifying the test could
observe the break. Three separate implementers caught three of them by *running* the check, which is
exactly why the instruction must be "observe RED", never "confirm the guard exists".

*Second:* **scope determines what a review can possibly find.** Seven task-scoped reviews missed the
Critical because no reviewer's scope was ever wider than one task. The whole-branch pass caught it in
one read. Conversely, `simplify` found duplication no correctness review would ever surface — four
identical helpers are *correct*, just wasteful.

*Third:* **`/finish-branch`'s simplify + review steps were nearly skipped as redundant, and were
not.** A stored preference generalised from one incident said to skip all three. Running them found
ten more items, including the shape-guard bug and three defects introduced by an unreviewed refactor
commit. The memory has been deleted.

*And on Copilot:* two comments, one accepted, **one rejected with evidence**. It claimed `rotated`
stays correct under an RLS-bypass connection; a probe (two tenants, two real rotations, PGlite as
superuser) returned `{"rotated":3,"alreadyCurrent":1}`. Both counters inflate. Reproduction posted
in-thread.

## 6. What remains

### Deferred from this PR

- **`startRealPostgres` is duplicated five times** and `test/seed.ts` three times. **Blocked on a
  real constraint:** `@waitron/db` has no `exports` map, and adding one is restrictive by default —
  it would break every existing deep import unless enumerated, and this repo uses them
  (`@waitron/payments/src/testing/fake-provider.js`). A barrel export instead makes
  `@testcontainers/postgresql` a transitive dependency of every consumer, which that package's own
  comment refuses. `seedTenant`/`freshNif` is the cheap half and needs no `exports` map.
- **`bin.ts` connects to the database before validating argv** — every malformed invocation pays a
  connect, handshake and teardown. It already gets this ordering right for the key ring.
- **`rotate` is coupled to the `PURPOSES` registry**: re-sealing re-runs `validatePayload`, so a
  field-list edit aborts the sweep mid-vault and **can block retiring a compromised key**.
  Documented in `store.ts`. Copilot found the **read-side twin** — reads do not validate either, so
  a row sealed under an older list returns a payload missing a field the host reads as `undefined`.
  Fixing reads extends the blast radius from "blocks rotation" to "takes the vault offline";
  **decide it before sub-project C lands**, not at a merge.
- **Ten `*.rls.test.ts` files share an unconditional `afterAll`** — payments 3, payments-stripe 4,
  fiscal-verifactu 3. Only `scheduler` and `credentials` guard theirs. **This count has been wrong
  twice** (four → seven → ten), so use the per-package breakdown. `*.concurrency.test.ts` has seven
  more of the same shape, a different file set.

### Still open from the payment layer

Unchanged by this cycle — see the drift-gate and scheduler handoffs. The `apps/*` host still carries
the webhook endpoint, signing-secret provisioning and `runDue`; `drain`'s legal hourly-retry duty is
as unscheduled as it was; `reverseViaStripe`'s full-refund amount on the interactive till paths is
untouched and #31's spec still **disqualifies** the "send our amount" fix.

**`drain` cannot submit regardless.** It needs a `VerifactuClient` whose `fetch` carries client
certificate material, and per [`getting-to-production.md`](../compliance/getting-to-production.md)
the qualified seal certificate is unobtained, unpriced, and its exportability for unattended server
use is explicitly unverified. That is bureaucratic latency no code shortens, and it is the real
critical path to anything running.

### Next

1. **Sub-project B — `DueAtDuty` in `packages/scheduler`.** Smallest of the three, independent of
   everything else, and the scheduler's design already says what it costs: a new derivation strategy
   plus a migration. Note `scheduled_runs.period_from`/`period_to` are `NOT NULL` today precisely to
   avoid speculating here, so this changes the ledger's shape.
2. **Sub-project C — the `apps/*` host.** Needs A and B. Still the single thing between this repo and
   anything actually running.
3. The **tab/tip lifecycle** and the **refund/void role-gate** are unchanged deferrals.

## 7. Environment notes

- `pnpm --filter @waitron/credentials test` runs 131 tests in ~8s; the real-Postgres suite needs
  `TESTCONTAINERS_RYUK_DISABLED=true` locally. **Never commit it.**
- The pre-push hook runs the full workspace gates in ~85s. Do not bypass it.
- **After landing a new package, run `pnpm install` in the main checkout** — otherwise the hook fails
  with `tsc: command not found`, and it blocks even a branch-*deletion* push.
- **`gh pr merge --delete-branch` aborts before deleting the remote branch** if a worktree still
  holds the local one. Tear the worktree down first.
- Resolve Copilot threads with the GraphQL `resolveReviewThread` mutation, passing the id as a
  **variable** — interpolating it into the query string fails with *"Expected string or block string,
  but it was malformed"*.
- **PGlite connects as a superuser and bypasses `FORCE ROW LEVEL SECURITY`.** Any test whose subject
  is RLS-scoped visibility must live in a real-Postgres suite. That bit twice here: a `list`
  de-duplication test and a rotation-count test were both meaningless under PGlite.
