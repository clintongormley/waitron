# Printing — Epson Server Direct Print — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Epson Server Direct Print as the second cloud-poll vendor — an Epson-shaped poll→fetch→ack endpoint beside the Star one, reusing the outbox/claim/ack/token machinery, selected by a per-printer vendor discriminator.

**Architecture:** A `printers.cloud_poll_vendor` (`star`/`epson`); an Epson endpoint variant backed by a shared `claimNextJob`/`ackJob`; the dashboard cloud_poll form gains the vendor choice + the Epson poll URL. Enqueue side unchanged.

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, `node:crypto`, Lit + Vite, Vitest, Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-printing-epson-server-direct-print-design.md](../specs/2026-08-17-printing-epson-server-direct-print-design.md).

## ⛔ Prerequisites — BLOCKED until the cloud_poll (Star) slice lands

Re-verify: the cloud_poll slice's `printers.poll_id`/`poll_token_hash`, `print_jobs.claimed_at`, `requirePollToken`, the Star poll/fetch/ack + claim-timeout requeue, the `print-api.ts` CloudPRNT group, the dashboard cloud_poll form.

**And, before Task 2: pin the Epson Server Direct Print / ePOS-Print contract against Epson's published spec** (verbs, the XML job envelope, status fields, how the printer presents its id/token). CLAUDE.md §1 — get the vendor document, quote the shapes into the task, then implement.

## Global Constraints

- **English identifiers** — `cloud_poll_vendor`. No new `SPANISH_WORDS`. UI copy en/es.
- **Reuse, don't reimplement** — the claim (`UPDATE…RETURNING`), requeue, `requirePollToken`, outbox, and dashboard form are the Star slice's; extract a shared `claimNextJob`/`ackJob` and back both vendors with it. **Star's behaviour must not change** (its tests stay green).
- **Domain codes** — reuse `printer.not_found` / `printer.poll_unauthorized`. No new code. `import "./errors.js"`.
- **Enqueue side untouched** — transport-only.
- **Vendor protocol** — pinned against Epson's spec (Prereq); media type (ESC/POS vs ePOS-Print/raster) a §3c build branch.
- **Non-fiscal** — grep receipt.
- **No back-compat / data-migration** (pre-production). **Migration via `db:generate`.** Re-run `inmutabilidad`.
- **Coverage:** db, server, `@waitron/printing` → 98/98/98/95; dashboard → 95/95/90/88. Real-PG for the claim race. `TESTCONTAINERS_RYUK_DISABLED=true`.

## File Structure

**Created:** `packages/db/drizzle/<NNNN>_cloud_poll_vendor.sql`.
**Modified:** `packages/db/src/schema/printers.ts` (`cloud_poll_vendor` + CHECK); `apps/server/src/print-api.ts` (the Epson group + the shared `claimNextJob`/`ackJob` extraction); `packages/printing/src/*` (Epson wire adapter + optional ePOS renderer); `apps/dashboard/src/{screens/printers-screen.ts, api/client.ts}`; `docs/backlog.md`.

---

### Task 1: Schema — `printers.cloud_poll_vendor`

- [ ] **Step 1:** Add the `cloud_poll_vendor` pgEnum (`['star','epson']`) + a nullable `cloud_poll_vendor` column on `printers`; a CHECK `(transport='cloud_poll') = (cloud_poll_vendor IS NOT NULL)`. `db:generate` → verify (enum + column). Note `<NNNN>`.
- [ ] **Step 2:** Real-PG: apply; the CHECK rejects a `cloud_poll` printer with no vendor and a non-cloud_poll printer with one; `inmutabilidad` green. `pnpm --filter @waitron/db test:coverage` (unfiltered).
- [ ] **Step 3:** Commit. `git commit -s -m "feat(db): printers.cloud_poll_vendor (star|epson)"`

---

### Task 2: Epson endpoint variant (shared claim/ack)

**Prereq:** the Epson SDP contract is pinned (Prerequisites) — quote the verbs/fields into this task.

- [ ] **Step 1:** Refactor test — extract `claimNextJob(tx, cfg, printerId)` / `ackJob(tx, cfg, jobId, status)` from the Star slice; assert the **Star path is unchanged** (its existing tests stay green — behaviour-preserving refactor).
- [ ] **Step 2:** Failing Epson test — an `epson` cloud_poll printer's poll claims the oldest queued job (real-PG double-poll race → one claim, proven by deletion of the shared lock), fetch serves its payload, ack → done; failed → requeue; claim-timeout requeue; a wrong token → 401. Shape to the pinned Epson contract.
- [ ] **Step 3:** Run → FAIL → implement the Epson wire adapter + the `/print-api/epson-sdp/:pollId` group calling the shared `claimNextJob`/`ackJob`; route `cloud_poll_vendor='epson'` printers here, `'star'` to the existing group. **§3c branch:** ESC/POS verbatim if accepted, else an ePOS-Print/raster renderer in `@waitron/printing`.
- [ ] **Step 4:** PASS (Epson green, Star still green), coverage. Commit. `git commit -s -m "feat(printing): Epson Server Direct Print variant (shared claim/ack)"`

---

### Task 3: Dashboard — vendor choice + Epson poll URL

- [ ] **Step 1:** Failing test — the cloud_poll printer form offers a vendor (`star`/`epson`); on `epson` it generates the token (shown once) + shows the Epson poll URL. Run → FAIL → implement (extend the Star form; `printer.manage`). a11y both themes.
- [ ] **Step 2:** PASS, coverage. Commit. `git commit -s -m "feat(dashboard): cloud_poll vendor choice + Epson poll URL"`

---

### Task 4: Fiscal grep, guards, backlog

- [ ] **Step 1:** H2 grep — enqueue side unchanged; `record-sale.ts`/alta builders untouched. Record.
- [ ] **Step 2:** Guard sweep — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; root Vitest.
- [ ] **Step 3:** Flip `docs/backlog.md` — Epson Server Direct Print **BUILT**; cloud-poll vendor coverage complete (Star + Epson).
- [ ] **Step 4:** Commit. `git commit -s -m "docs(backlog): Epson Server Direct Print built; chore: H2 grep"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2 `cloud_poll_vendor` → T1; §3a Epson endpoint + §3b shared machinery → T2; §3c media type → T2; §5 dashboard → T3; §4 fiscal → T4. No gaps.

**2. Placeholder scan** — real test/impl throughout; the deferrals are the cloud_poll re-verification + the **Epson protocol pinning** (a hard Prerequisite/Task-2 step) + the media-type branch (§3c) + the `db:generate` number — all flagged.

**3. Type consistency** — `cloud_poll_vendor` values `star`/`epson` consistent T1→T2→T3; `claimNextJob`/`ackJob` extracted once (T2) and shared by both vendors; `requirePollToken` reused; enqueue (Slice A) untouched. The behaviour-preserving refactor (Star stays green) and the shared claim race are the load-bearing proofs (T2).

**Known risk** (flagged): the **exact Epson SDP/ePOS fields are a vendor contract** — pinned against Epson's spec before Task 2 (CLAUDE.md §1), not coded from memory; the payload media type (ESC/POS vs ePOS-Print) resolved from that spec (§3c). The `claimNextJob` extraction must not change Star's behaviour (T2, its tests green).
