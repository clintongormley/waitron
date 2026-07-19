# Handoff — sub-project 1 landed, next is the sales spine

**Date:** 2026-07-19
**Branch state:** `main` at `fc69721`, clean, CI green.
**Next work:** sub-projects 2+3 — the sales spine and the fiscal layer, specced together.

---

## Read these first, in this order

Most of what matters is committed. This handoff only carries what those documents do *not* say.

1. [`docs/superpowers/specs/2026-07-18-pos-architecture-design.md`](../superpowers/specs/2026-07-18-pos-architecture-design.md) — the whole system. §2 phasing, §5 sync tree, §6 fiscal design, §8 repository shape.
2. [`docs/compliance/verifactu-findings.md`](../compliance/verifactu-findings.md) — **authoritative** on regulation, sourced from AEAT and BOE primary texts. Where it and the architecture doc disagree, this wins.
3. [`docs/compliance/asesor-questions.md`](../compliance/asesor-questions.md) — what remains unresolved, with Spanish formulations.
4. [`docs/developers/design-system.md`](../developers/design-system.md) — the UI contract every later screen follows.

---

## Where the project is

An open-source POS to replace Square, first deployed at a **new deli in Barcelona that has not opened yet** — a greenfield launch, not a cutover. The existing restaurant (bar, kitchen, tables, on Square) migrates later. It must run both self-hosted standalone and as multi-tenant cloud, from one codebase.

The deli trades as a **sociedad**, so its Verifactu obligation begins **1 January 2027**. It opens somewhere in October 2026 – January 2027.

**Sub-project 1 (design system) is done and merged.** Sub-projects 2 and 3 are next and are joined at the hip, because the hash chain *is* the sales table.

---

## What sub-project 1 delivered

`packages/ui` — a `--wt-*` CSS custom property token layer with light and dark themes, six Lit 3 primitives (`wt-button`, `wt-icon`, `wt-card`, `wt-input`, `wt-dialog`, `wt-switch`), a Vite workbench, and the contract doc.

- **131 tests**, all in real Chromium via Vitest browser mode.
- Coverage 95.71/93.75/95.83/95.71, thresholds enforced and verified to actually fail when breached.
- Stryker mutation score **78.99%**.
- Two automated guards: `no-hardcoded-chrome` (glob-discovered, catches hex/`rgb`/`hsl`/`color()`/named colours and spacing above 1px) and a systemic tap-target + focus-delegation guard.
- axe-core accessibility tests per primitive, per state, per theme.

**jsdom is banned in this package and that is not a style preference** — it cannot compute CSS custom properties, so a token test written against it asserts nothing. This was proven, not assumed.

---

## Process lessons that will matter more in the fiscal layer

**Four tests shipped passing while the behaviour under test was absent.** Not similar bugs — the same bug, four times:

- A harness test asserting custom properties resolve used `el.style.setProperty()` and read it back. jsdom does that correctly too, so it never gated the regression it existed for.
- A test named "data-theme overrides the media preference" never emulated a conflicting preference. It passed with the `@media` block deleted.
- A test named "tokens are overridable per deployment" passed with the **entire token layer absent** — inline styles always win for custom properties.
- The event `bubbles`/`composed` flags — the whole reason those events exist — were asserted by nothing.

**Root cause: the TDD red phase was verified per FILE, not per TEST.** A test that passes while its feature is absent passes during red, and "2 of 3 failed" hides it. The fix is now a Global Constraint: *observe every new test failing individually before writing its implementation; a test that passes before its feature exists is a defect in the test.*

**What actually caught these:**

- **Mutation testing.** It found the unguarded event flags that four human-directed reviews missed. In the fiscal layer — where a hollow test means an unverified hash chain — this is the highest-value tool available.
- **Teeth checks.** Deliberately break the thing, watch the test fail, restore. Every fix this session was verified that way. Do the same for chain construction: mutate a huella, confirm something screams.

A hollow test in a design system means a button looks wrong. A hollow test in the fiscal layer means an unverifiable chain and a €50,000 exposure. **Budget for mutation testing on `packages/verifactu` from the first commit.**

---

## Governance is now live — this changes the workflow

Ruleset `19157474` ("main protection") on `main`, verified by an actually-rejected push:

| Rule | Setting |
| --- | --- |
| Required status checks | `static-analysis`, `typecheck`, `test` — strict |
| Pull request | required; 0 approvals; unresolved threads block merge |
| Copilot review | automatic, **on every push** |
| Merge methods | squash or rebase only |
| Force-push / deletion | blocked |
| Bypass actors | **none**, including the owner |

**Consequences:** no direct pushes to `main` — everything goes through a PR. A husky **pre-push hook** runs lint, format, typecheck and the full suite locally first (~3s); bypass with `git push --no-verify` only in emergencies.

Gotcha worth remembering: `automatic_copilot_code_review_enabled` as a `pull_request` ruleset parameter is **silently accepted and discarded**. It only works as a separate `copilot_code_review` rule. Always re-read a ruleset after writing it rather than trusting the 200.

---

## Toolchain facts

- Node **26** (`.nvmrc`), pnpm **9.15.0**.
- `pnpm exec playwright install` **fails from the repo root** — root `pnpm exec` does not resolve a workspace-scoped bin. Use `pnpm --filter @waitron/ui exec playwright install --with-deps chromium`.
- `packages/ui/src/vite-env.d.ts` is **load-bearing**, not redundant: `vite` is not hoisted into `packages/ui`, so the `vite/client` type reference never resolves. Verified with `tsc --traceResolution`.
- ESLint already carries the `packages/verifactu` zero-dependency boundary rule, written before the package exists and verified to fire against a probe. **Sub-project 3 will be the first code it constrains.**
- Worktrees here are created by `EnterWorktree` under `.claude/worktrees/`, **not** by `worktree.py`. `/land-branch`'s teardown step does not apply; use `git worktree remove --force` and `git branch -D`.

---

## Decisions made this session that are not in the committed docs

- **Build Veri\*Factu mode only.** No XAdES, no registro de eventos, no requerimiento path, until a user needs them. This demoted asesor Q3 and Q4. Two constraints keep it a deferral: record construction and chaining stay mode-independent, and mode is a per-SIF field in the data model from the start even though only one value is ever set.
- **Q2 is resolved favourably** by research done during the session: AEAT's developer FAQ v1.3 §5 explicitly blesses a TPV generating the record and a central backoffice relaying it. **Certificates can stay off the tills.** What remains is a narrower latency question folded into Q3.
- **Q1 is assumed true** — that a fast-syncing till is an independent SIF, so chains are per-till. The user has explicitly said not to raise the DGT consulta again; work on the assumption. The design already isolates it: chains are keyed by (SIF, NIF), so if it ever changes it is a change in *which node owns the chain*, not a re-model.
- Tip distribution must support **both** direct-to-employee and pooled, configurable per tenant — the two have different withholding treatment, so the attribution data must exist from the start even though the payroll export is restaurant-phase.

---

## Deferred, with triggers

| Item | Trigger |
| --- | --- |
| Widen `no-hardcoded-chrome` from a package test to a workspace-wide ESLint rule | when the first view package (`apps/till`) exists — the contract promises "any component **or view**" and today only components are checked |
| Form association via `ElementInternals` (`name`, `required`, validation) | when a real form needs native submission; `type="submit"` was removed rather than left inert |
| Visual regression snapshots | when the UI stabilises; judged highest-maintenance, lowest-yield of the tooling options |
| `size-limit` bundle budget | when there is an app to measure |
| Shared base class for interactive primitives beyond what exists | if a seventh primitive repeats the boilerplate again |

---

## What was lost

`.superpowers/` was gitignored and lived inside the worktree, so **the progress ledger and every per-task implementation and review report died with the teardown**. The committed design docs, plan and contract are intact; the working notes are not. If a future session wants that audit trail, put the ledger somewhere tracked or outside the worktree.

---

## Standing preferences

- **Do not raise the DGT consulta again.** Work on stated assumptions.
- Recommendations over surveys — lead with a pick and the reasoning.
- Findings must be verified empirically, not asserted. Several reviews this session were valuable precisely because the reviewer installed the dependency and ran the experiment rather than reasoning from docs.
- Subagent-driven development worked well for implementation. It does **not** work for design — that is a conversation with the user.

---

## Next: sub-projects 2 + 3

Specced together. The architecture doc §6 already fixes the important shapes:

- **Working orders and fiscal records are different tables.** An open order is mutable; a fiscal record is immutable, chained, and created exactly once when all tenders settle — not per payment, or split tender breaks.
- **One chain per till, because each till is its own SIF** — not because it has its own series. Series is a data field and a hash input, never a chain boundary. Alta and anulación interleave in one chain in generation order.
- **The predecessor pointer is an invoice identity, not an index**: NIF + serie&número + fecha de expedición + first 64 chars of the predecessor huella.
- **Values are snapshotted into records, never referenced.** A stale catalogue is therefore not a correctness problem.
- **Chaining is local and synchronous; submission is asynchronous and retryable.** An AEAT outage must never block selling.
- Art. 7.i requires verifying the stored predecessor huella **before generating each record** — that belongs in the sale write path, not a periodic audit.
- Numbering may never be reused, **even for test invoices**. This constrains the testing strategy: fixtures and AEAT preproduction only, never a production NIF.

**Open design questions for the next session** (these are design, not regulatory):

1. The exact schema for working orders vs fiscal records, and the transition between them.
2. The outbox: ordering per SIF, hourly-retry duty (art. 16.4), `Incidencia="S"` flagging, and the **persistent on-screen unsent-record count**, which is a UI requirement not yet reflected anywhere.
3. `packages/verifactu`'s public API — it must know nothing of tills, sales or tenants, and the lint boundary already enforces that.
4. Tenancy strategy within Postgres: row-level + RLS, schema-per-tenant, or database-per-tenant. Fiscal data pushes harder toward real isolation than typical SaaS.
5. Installation-number lifecycle and `PrimerRegistro="S"` handling on reimage or hardware swap.
6. Clock accuracy — art. 7.f requires one-minute precision, and a till may be offline for days without NTP.

Start with the brainstorming skill, not with code.
