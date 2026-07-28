# Handoff — the exports map landed, and then the certificate arrived and worked

**Date:** 2026-07-28
**Type:** *Backward-looking*, with one live branch parked at a human gate.
**Main at handoff:** `c41dc8e`. **Active branch:** `first-aeat-submission` (8 commits, unpushed).

| PR | Squash | What |
| --- | --- | --- |
| #2 | `c41dc8e` | **The `@waitron/db` exports map** — one real-Postgres helper instead of six |

42 files, +2001/−455. Then the day changed shape: **the qualified certificate exists, and it works.**

---

## 1. The headline: AEAT answered

The critical path every handoff since the fiscal drain has named — "*that is the real critical path,
and no code shortens it*" — is **open**. A `consultar` from `apps/server` against
`https://prewww1.aeat.es/…/VerifactuSOAP`, using the deli's real certificate, returned in 300 ms:

```json
{ "ResultadoConsulta": "SinDatos", "IndicadorPaginacion": "N", "registros": [] }
```

`SinDatos` is the correct answer — this obligado has filed nothing. What it establishes, none of
which had ever been observed:

- The exported PKCS#12 **`representante` key works unattended**. No token, no interactive unlock.
  This was the one risk that could have invalidated the entire unattended-submission design.
- The mTLS handshake succeeds on the runtime's default trust store; no intermediate needed.
- `packages/verifactu`'s serializer produced an envelope **AEAT accepted**, and its parser handled a
  **real AEAT response**. Every previous test of both ran against fixtures.
- Obligado `B13817952` (SANTET DELI CO SL) is recognised in pre-production.

Full record: [`docs/compliance/first-aeat-contact.md`](../compliance/first-aeat-contact.md).

**What it does NOT establish:** that a *submission* will be accepted. `consultar` is a read. No
`RegistroAlta` XSD validation, no chain, no coherence check between the certificate, the NIF and the
`IdSistemaInformatico`. That is the next unknown and it is what the parked branch exists to reach.

**Two things it raised:**

1. **The certificate expires 2027-10-03.** Renewal is now a dated operational task, and nothing
   warns on approach. An expired certificate fails *exactly like having none* — every drain pass
   skips every tenant — so it would look like a regression rather than an expiry.
2. **`ObligadoEmision.NIF` is the company's `B13817952`, never the natural person's ID** in the
   certificate subject. The certificate identifies a representative; the filing is for the company.

## 2. PR #2 — the exports map

`@waitron/db` had no `exports` map, so `startRealPostgres` had been copy-pasted **six** times and a
`seedTenant`/`freshNif` pair **three** times.

**The recorded blocker did not exist.** The deferral said an exports map "would break every existing
deep import". `@waitron/db` has **zero** deep imports — 202, all through the barrel. The real
constraint was the barrel's documented refusal to make `@testcontainers/postgresql` transitive,
which a subpath resolves.

| wrapper | before | after |
| --- | --- | --- |
| `credentials`, `scheduler` | 52 each | 23 each |
| `payments`, `payments-stripe`, `fiscal-verifactu` | 67 each | 25 each |
| `apps/server` | 67 | 26 |
| shared helper | — | 172 + 185 test |

All 23 `startRealPostgres` call sites kept their exact import lines. Two real leaks closed: five of
six copies closed their migrator only on success and stopped their container never — both guards now
exist on both paths, each **proven by deletion** (remove a close, the test fails with a leaked
backend).

Also: `POSTGRES_IMAGE` replaced the image literal in every suite, `CORE_MIGRATIONS`' second
definition is gone, five dead `@testcontainers/postgresql` devDependencies removed, and `harness.ts`
now takes its container from the shared helper.

## 3. The repository was rewritten mid-session

Not by us. New GitHub history, ELv2 licence, `CONTRIBUTING.md`, and a `licence` workflow.

- **PR numbering restarted at #1.** `#1` is the licence change, `#2` is the exports map. `#33`–`#36`
  exist only in these notes now.
- **Every commit needs `git commit -s`.** The `dco` job walks the whole PR range. `git rebase
  --signoff <base>` fixes a branch that forgot.
- The spec commit survived the rewrite and rebased cleanly; nothing was lost.

## 4. The dominant defect class, sharpened

**Six false or overbroad claims shipped on PR #2 — and four were introduced while correcting an
earlier one.** Two were written by this session, minutes after instructing a subagent to verify its
claims.

- A comment corrected to remove two false facts kept a conclusion a later PR had already falsified.
- A doc correction scoped one sentence "of the 22" and left the very next one unscoped.
- A `simplify` cleanup added "the one place in this package that constructs a container" while two
  other files still did.

**The correction step is the dangerous moment, not the original writing.** A correction is a claim.
It needs the same "what would make this false?" pass, and the reader who catches it is always a
*different* one.

The same class then appeared on the new branch: `bootstrap-tenant.sql`'s header claimed "RLS is
bypassed for the owner". `FORCE ROW LEVEL SECURITY` exists precisely to deny that — and the
container proof only passed because it connected as a true superuser. Proven empirically: as a
non-superuser owner the first INSERT fails with `new row violates row-level security policy`.

**Copilot earned its keep with a new pattern:** a *house-pattern deviation*. Its single comment on
#2 was the only real finding no other layer caught — `seed.test.ts` never closed the `Database` that
`target.create()` returns, and it was the **only** `describeEachTarget` suite in `packages/db` that
didn't (nine others do). Before dismissing a Copilot comment, check the sibling files.

## 5. Running the plan found five defects the plan-writing did not

All surfaced only by execution, and two would have failed **only against the real database**:

1. `read -rs -p` is bash; this repo's shell is zsh, where `-p` means "read from a coprocess". Failed
   on the operator's very first command.
2. The build produces `dist/server.js`, not `dist/bin.js`.
3. The default HTTP port is **8080**, not 3000.
4. `boot.ts` calls `loadKeyRing` (line 96) **before** `applyMigrations` (line 104) — so the plan's
   ordering was wrong: the step that migrates the deli's database came before the step that
   generates the key it needs.
5. The RLS/owner claim above.

## 6. Decisions worth not relitigating

- **The exports map is enumerated, not a wildcard.** A wildcard would publish `harness.ts` and give
  `asAppUser` a second import path.
- **The six wrappers stay.** Two `simplify` angles wanted them folded into one helper; the altitude
  reviewer disagreed and the spec had already chosen explicit per-caller migration ordering.
- **Shared `freshNif` uses a 40-million base** — every other surviving generator is on 10M or 20M.
- **C3's premise was wrong.** The webhook tenant is *not* "only discoverable from the unverified
  payload" — that is true under Stripe Connect, and `reconciler.ts:27` records the opposite
  architecture. Each tenant has their own Stripe account, so a per-tenant webhook endpoint already
  exists by construction (the `whsec_…` only exists because someone created one). Tenant-in-path;
  `resolve_payment_tenant` becomes a cross-check rather than the discovery mechanism.
- **C3's scope, already chosen:** prompt-settle for Mode 3 hosted checkout only. Reconcile stays the
  safety net. Refunds/disputes deferred.
- **AEAT: pre-production first**, the probe calls `consultar` and never `submit`, bootstrap uses
  reviewed SQL rather than test seeds, and no provisioning CLI gets built yet.

## 7. Where the live branch stands

`first-aeat-submission`, 8 commits, all signed off, **not pushed**:

| | |
| --- | --- |
| `69518d3` | spec |
| `a7f94fe` | plan (5 tasks, 9 `[HUMAN]` steps) |
| `d58fabc` | the read-only probe — reviewed, both safety properties verified |
| `15d5c65` | the zsh `read -p` fix |
| `b611d61` | the AEAT result, recorded |
| `5cafbd4` | `bootstrap-tenant.sql` |
| `90bb66f` | four operational errors in the plan, corrected |
| `d44c689` | the false owner-exemption claim, corrected |

**In flight at handoff:** Task 4's `record-one-sale.ts` was dispatched and had not reported. Check
`git log` before assuming it is missing — there is no till application, so this script is the only
way to put a real sale into the chain.

### The gate, and it is yours

Everything remaining in this plan needs a human at a terminal with real data:

1. **Generate and store the credential key ring** (`openssl rand -base64 32`, plus a version). It is
   the AES-256-GCM master key for the vault; losing it makes every sealed credential unrecoverable,
   and `boot.ts` will not even migrate without it.
2. **Create the deli's database** via `apps/server/README.md`'s grant recipe — its **first real
   use**; it is hand-verified, not test-covered, so failures there are findings. Boot the host once
   to migrate (there is no `--migrate-only`), then run `bootstrap-tenant.sql` **as a superuser**.
3. **Seal the certificate** into the vault: `waitron-credentials set --tenant <id> --purpose
   fiscal.aeat`, payload as JSON on stdin. Build the CLI first — `dist/bin.js` does not exist in a
   fresh checkout.
4. **Record one sale, start the host, watch drain submit it.** Then Task 5: write down what AEAT
   actually did.

## 8. What else remains

- **C3, the webhook endpoint** — designed and scoped, not started. Resumes after AEAT.
- **The unguarded `afterAll` pattern** — ten `.rls.test.ts` plus seven `.concurrency.test.ts` files
  where a failed `beforeAll` surfaces as `Cannot read properties of undefined (reading 'close')`. It
  blocked a push during this session, so it now has a real cost attached.
- **#35's leftovers**: `bin.ts` has no try/catch; `server.listen_failed` is not bind-scoped; nothing
  validates the two DB URLs address the same database; `createPostgresDb` swallows pool errors.
- **`payments.stripe` is unprovisioned** for the deli. Card payments need it; the fiscal path does
  not.
- **Certificate renewal before 2027-10-03**, with no warning mechanism.

## 9. Environment notes

- **`/land-branch` has been amended** (`~/.claude/commands/land-branch.md`): `--delete-branch` is
  gone from all three merge fallbacks. It aborted the *whole* delete step whenever a worktree still
  held the local branch — four cycles running — silently leaving the remote branch behind. The
  command now merges bare and deletes both refs explicitly, verifying the remote one is gone. **Do
  not re-add the flag.**
- **Docker contention is real on this machine.** Running several packages' suites concurrently hit
  port-bind timeouts twice, surfacing as that unguarded-`afterAll` error. CI has never reproduced it.
- **Verify CI runs belong to the current head SHA** before trusting them (`gh run list --json
  databaseId,headSha`).
- Plain `gh pr merge --squash` worked again; `--admin` remains dead. Resolved conversations are the
  gate — resolve Copilot threads via the GraphQL `resolveReviewThread` mutation, id passed as a
  variable.
- The spec and plan commits were created **on the feature branch from the start**, both cycles. The
  `git pull --ff-only` trap did not fire. Keep doing this.

## 10. Next

1. **The human gate above.** Nothing else on that branch can move without it.
2. **Task 5** — write down what AEAT did, including whether #35's and #36's observability made a
   first contact readable. If it did not, that finding outranks the submission.
3. **C3**, already scoped.
