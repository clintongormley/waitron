# Waitron — working notes for Claude

A Spanish restaurant POS with Veri*Factu fiscal compliance. It files invoice records with AEAT (the
Spanish tax agency) and takes card payments through Stripe.

**What makes this codebase unusual:** some mistakes here cannot be fixed afterwards. Fiscal records
are append-only and hash-chained, invoice numbers are never reused, and chains cannot be merged or
migrated. A wrong filing is not repairable by editing data. That is why the conventions below are
strict and why claims in comments are held to an unusual standard.

---

## 1. Writing claims — the house's dominant defect class

**Comments and docs that assert more than the code delivers are this repo's most common defect**, by
a wide margin. Every retrospective names it. Read this section before writing an explanatory comment.

### A claim of necessity or impossibility needs a receipt

Any sentence of the form _"X is required"_, _"only Y can"_, _"Z cannot"_ must carry either the
command that was run or a cited `file:line`. The good pattern already exists in the tree:

> `-- Proven on PostgreSQL 18 against the real migrations, as a LOGIN role with rolsuper = f and`
> `-- rolbypassrls = f: the four tenant-scoped inserts below succeed.`

Two false claims shipped in one day for want of this. `bootstrap-tenant.sql` asserted superuser was
unavoidable — it is not, and ninety seconds with a container disproved it. Its _correction_ then
asserted psql "cannot generate a uuid into a variable", contradicted by the same file's own three
uses of `\gset`.

**Reading is not verification.** That superuser claim survived a correction pass, a four-agent
simplify, a fresh-context review and Copilot — four layers, all reading, all checking whether it was
_self-consistent_ rather than whether it was _true_. Adding a fifth reader would not have helped.
Run the thing.

### State the experiment, not the conclusion

"I deleted the tenant predicate and the test failed" is checkable. "The guard is proven" is not, and
is how a third false claim happened — an experiment on one mutation, written up as a claim about a
different mutation that was never run. If the sentence describes more than what you ran, narrow it.

### "Pre-existing" and "not a regression" are claims too

Both are load-bearing — they decide whether something gets fixed now or deferred — and both are
routinely asserted from impression. Check with `git log`/`git blame` before saying either, and if you
have not checked, say so: "I believe this predates the branch" is honest, "this is pre-existing" is a
finding. The same goes for "harmless", "unreachable" and "narrow": each is a claim about behaviour
under conditions you may not have enumerated.

### The correction is a new claim

Both false claims above were born _while fixing someone else's_. Attention goes to the old text
being wrong, and the replacement is written with the confidence of having just discovered something.
Apply the same "what would make this false?" pass to your correction that you applied to the
original.

### Before asserting a convention, grep the siblings

Two defects landed this way: an error code prefixed `payments.` where all twelve siblings use
`payment.`, and a param named `recordId` in a file that is 7-0 on `registroId`. Both were one grep
from being avoided. Error codes are **never renamed once shipped** (see below), so these are free to
fix before merge and permanent after.

---

## 2. The gate

```bash
pnpm lint && pnpm typecheck && pnpm format:check && pnpm test
```

Two traps that each cost a round trip:

- **CI's `test` job runs `pnpm test:coverage`, not `pnpm test`.** The pre-push hook runs plain
  `pnpm test`, so a coverage-threshold regression passes locally and fails in CI. Before claiming a
  package is green, run `pnpm --filter <pkg> test:coverage`.
- **The pre-push hook does not run `--frozen-lockfile`.** Moving a dependency between
  `dependencies` and `devDependencies` passes locally and fails CI at the install step. Run
  `pnpm install` and commit the lockfile.

On bypassing the hook, see §6 — the hook's own header sanctions `--no-verify` in an emergency, and
the underlying failure still has to be fixed because CI runs the same checks.

**Coverage thresholds** are `statements 98 / lines 98 / functions 98 / branches 95` in every package
except `packages/ui`, which is `95/95/90/88` with a documented reason in its own config.

---

## 3. Conventions reviewers enforce

**Error codes name the DOMAIN CONCEPT, never the throwing package.** `series.not_found`, not
`db.series_not_found` — see the design note atop `packages/shared/src/errors.ts`. That one code was
renamed twice to converge on the rule. Codes are **never renamed once shipped**; a wrong one is
deprecated and a new one added beside it. `server.*` is reserved for facts about the process itself
(`apps/server/src/errors.ts` says so in its own doc comment) — "no such tenant" is a fact about a
tenant, not about the process.

Every file that throws a code imports its registry (`import "./errors.js"`) directly.

**Spanish domain terms are deliberate**, guarded by `packages/db/src/english-only.ts`. Fiscal tables
and columns use the Veri*Factu vocabulary (`envios`, `estado`, `huella`, `secuencia`, `entorno`). Add
new Spanish schema tokens to `SPANISH_WORDS`. `packages/verifactu` and `packages/fiscal-verifactu`
are exempt from the guard; `apps/*` is out of scope by a recorded decision.

**`@waitron/db`'s `exports` map is enumerated, not a wildcard** — `.`, `./testing/postgres.js`,
`./testing/seed.js`. A wildcard would publish the harness and give `asAppUser` a second import path.
A consequence worth knowing: `apps/server` cannot deep-import `packages/db`'s `errors.ts`.

**Never widen a grant to make a test pass.** `app_user` holds `SELECT` on `tenants` and not `INSERT`
deliberately — the running POS cannot create tenants.

---

## 4. Testing

Two targets, and the choice matters:

- **PGlite** (`createPgliteDb` + `runMigrations`) — hermetic and fast. Every connection is a
  superuser, so it cannot show behaviour under the non-superuser deployment role, and it serialises
  every query onto one backend, so a contention test on PGlite is a **false pass**, not a weak one.
- **Real Postgres** via Testcontainers — required for anything about privileges, RLS as the
  deployment role, or concurrency. `packages/db` offers `describeEachTarget`
  (`src/testing/harness.ts`) to run a suite against both.

Pick the lighter one when the heavier one's justification does not apply to your suite, and say why
in a comment.

**`TESTCONTAINERS_RYUK_DISABLED=true` is required locally** or container suites hang for 180s.
Docker contention on a full `pnpm test` shows up as `EADDRINUSE`; it passes on retry and CI has never
reproduced it.

**Guard every teardown**: `if (db !== undefined) await db.close()`. An unguarded `afterAll` turns a
`beforeAll` failure into `Cannot read properties of undefined (reading 'close')` and masks the real
error. Suites sharing a database must clean up in a `finally` so they are order-independent, not
order-reliant — several tests have been fixed for exactly this.

**Prove a guard by deletion.** Remove the check, confirm the test fails, restore it. A test that
still passes with the guard removed is not testing the guard. Do the same for a negative control:
confirm it fails for the reason you think it does.

---

## 5. Fiscal invariants — the unrecoverable ones

- **One database per environment.** A pre-production database is never promoted.
  `invoice_series.next_number` carries across, so pre-production sales leave a permanent hole in the
  production series — and detecting exactly that is what Veri*Factu is for. `WAITRON_ENV` governs
  this; unset means `preproduction` and `production` must be typed out.
- **Nothing may block a sale** on anything but the sale itself. A till that cannot sell is a shop
  that cannot trade. Fiscal submission is an outbox, never inline.
- **`registros_facturacion` is immutable**: `REVOKE ALL`, an append-only trigger, and a
  TRUNCATE-blocking trigger. Do not work around them; a value written wrong there stays wrong.
- **Never put our own metadata into a hash.** `entorno` is ours, not AEAT's, and a test pins that two
  records differing only in it hash identically. If it entered `computeHuella`, every chain written
  under one environment would become unverifiable under the other.
- **Re-registering a till starts a new chain** and mints a fresh installation number. Correct for a
  reimaged till, destructive for a working one.

---

## 6. Workflow

**Branches and merging:**

- **Never commit directly to `main`** — always create a feature branch first. Feature work happens
  in a worktree (`worktree.py new waitron <branch>`), not the main checkout.
- **Branch names are descriptive**, e.g. `feat/provisioning-cli`, `fix/rls-superuser-claim`.
- **Do not merge a PR automatically — wait for the user's approval.** Invoking `/land-branch`
  _is_ that approval; nothing else is.
- **After merging, delete the feature branch**, local and remote. Verify the remote one is actually
  gone — it has repeatedly survived the merge (`git ls-remote --heads origin <branch>` must print
  nothing).
- **Every commit needs `git commit -s`.** CI's `dco` job walks the whole PR range.
- **Merging requires resolved conversations.** `mergeStateStatus: BLOCKED` with green checks means
  unresolved Copilot threads. Read them before resolving — on two consecutive PRs Copilot's single
  comment was the only real finding no other layer caught, both times by checking sibling files.
  Resolve via the GraphQL `resolveReviewThread` mutation with the id passed as a variable.
- **Verify CI runs belong to the current head SHA** (`gh run list --json databaseId,headSha`).

**Before a PR**, run the gate in §2 yourself rather than relying on the pre-push hook. The hook
mirrors CI's fast checks but is **not** identical to it — see §2 for the two places they diverge.
Bypassing the hook with `--no-verify` is for emergencies only, and the underlying failure still
needs fixing because CI runs the same checks.

**Before a release** (when there is a release process — there is none yet), update the docs and
tests alongside the code.

**Docs:**

- Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, session handoffs in
  `docs/handoffs/`.
- **These are committed here, deliberately** — unlike some sibling repos, where `docs/superpowers/`
  is gitignored as local scratch. In Waitron a plan doubles as the operator's runbook (the AEAT
  submission plan is executed by a human at a terminal), so it belongs in history. Do not gitignore
  them.
- Historical docs record what was true when written. Add a dated pointer rather than rewriting their
  history to pretend they always said the current thing.

**After pulling a branch that added a workspace dependency, run `pnpm install`** in the main
checkout, or typecheck fails on a module that exists.

---

## 7. Keep this file current — it is part of the work, not a chore

**This file is maintained continuously, not rewritten occasionally.** Every rule above was paid for
by a defect, a wasted round trip, or a review finding. When you pay that price again, the lesson goes
here in the same change that fixes it — not into a handoff that the next session may not read.

**Add an entry when any of these happens:**

- A review finds a defect whose _shape_ could recur — a convention nobody wrote down, a claim that
  outran its evidence, a test that passed for the wrong reason.
- A trap costs real time: a gate that behaves differently locally than in CI, a command that fails
  in this shell, a tool that needs a flag here and nowhere else.
- You discover a convention by grepping rather than by reading — that is precisely the convention
  that was missing from this file.
- A decision gets made that a future session would otherwise relitigate, or worse, silently reverse.

**Do not add:** one-off bugs with no reusable shape, anything the code or types already state
plainly, or the narrative of what a session did. The last of those belongs in `docs/handoffs/`; this
file carries only what changes how the _next_ piece of work is done.

**The receipt rule in §1 applies to this file too.** An entry states the rule and what it cost —
"CI's `test` job runs `test:coverage`, not `test`" is followed by the consequence that made it worth
writing. A rule with no evidence behind it reads as opinion and gets ignored by the session that
most needs it.

**Prune as well as append.** A rule that has been superseded, or whose underlying trap was fixed in
the code, is worse than no rule: it teaches a session to work around something that no longer
exists. Delete it rather than leaving it to rot, and say so in the commit.

Natural moments to do this: while addressing review findings (the lesson is freshest and the branch
is already open), and when writing a handoff — anything in the handoff phrased as "next time,
remember to…" belongs here instead, because a handoff is read once and this file is read every
session.
