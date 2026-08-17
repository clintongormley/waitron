# Printing — the `cloud_poll` transport (Star CloudPRNT) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `cloud_poll` transport — a Star CloudPRNT poll endpoint (poll → fetch → ack, token-authed) that serves the central outbox, so a NAT'd printer prints jobs enqueued on any node with no agent.

**Architecture:** No new table (Slice A carries `poll_id`/`poll_token_hash`/the enum); a `print_jobs.claimed_at` for claim/timeout; a CloudPRNT endpoint group that atomically claims a queued job, serves its ESC/POS payload, and acks; per-request token auth; dashboard config that generates the token + shows the poll URL. Enqueue side unchanged.

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, `node:crypto`, Lit + Vite, Vitest, Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-printing-cloud-poll-transport-design.md](../specs/2026-08-17-printing-cloud-poll-transport-design.md).

## ⛔ Prerequisites — BLOCKED until the printing subsystem lands

Re-verify: Slice A `printers` (+ `transport='cloud_poll'`, `poll_id`, `poll_token_hash`), `print_jobs` (+ `status`), the `print-api.ts` mount, `verifySecret`/`timingSafeEqual`, `printer.not_found`.

**And, before Task 3: pin the Star CloudPRNT contract against Star's published spec** (the exact poll/get/delete verbs, JSON fields, media-type strings, and how the printer presents its token). CLAUDE.md §1 — do **not** code the fields from memory; get the vendor document, quote the relevant shapes into the task, then implement.

## Global Constraints

- **English identifiers** — `claimed_at`. No new `SPANISH_WORDS`. UI copy en/es.
- **Domain codes** — `printer.poll_unauthorized` (401); reuse `printer.not_found`. `import "./errors.js"`. Never renamed.
- **Reuse crypto** — poll-token verify via `verifySecret` (constant-time). No new crypto.
- **Permission** — `printer.manage` (config); poll endpoints are token-authed.
- **Enqueue side untouched** — no change to how Slice B / the receipt consumer enqueue; this is transport-only.
- **Non-fiscal** — grep receipt.
- **No back-compat / data-migration** (pre-production). **Migration via `db:generate`.** Re-run `inmutabilidad`.
- **Vendor protocol** — pin against Star's spec (Prereq); media-type (ESC/POS vs Star markup) is a §3d build branch, not an assumption.
- **Coverage:** db, server, `@waitron/printing` → 98/98/98/95; dashboard → 95/95/90/88. Real-PG for the claim race. `TESTCONTAINERS_RYUK_DISABLED=true`.

## File Structure

**Created:** `packages/db/drizzle/<NNNN>_print_jobs_claimed.sql`.
**Modified:** `packages/db/src/schema/print-jobs.ts` (`claimed_at`); `apps/server/src/{print-api.ts, print-agent-session.ts (or a poll guard), errors.ts}`; `packages/printing/src/*` (poll claim/serve/ack + optional Star-markup renderer); `apps/dashboard/src/{screens/printers-screen.ts, api/client.ts}`; `docs/backlog.md`.

---

### Task 1: Schema — `print_jobs.claimed_at`

- [ ] **Step 1:** Add `claimedAt timestamptz` (nullable) to `print_jobs`. `db:generate` → verify (one column). Note `<NNNN>`. No custom RLS part (inherits).
- [ ] **Step 2:** Real-PG: apply; `claimed_at` visible/writable under `app_user`; `inmutabilidad` green. `pnpm --filter @waitron/db test:coverage` (unfiltered).
- [ ] **Step 3:** Commit. `git commit -s -m "feat(db): print_jobs.claimed_at for cloud-poll claim/timeout"`

---

### Task 2: `printer.poll_unauthorized` + `requirePollToken`

- [ ] **Step 1:** Failing test — `printer.poll_unauthorized` (401); `requirePollToken(pollId, presentedToken)` accepts the right token, rejects wrong/absent (constant-time via `verifySecret`), rejects a deactivated printer.
- [ ] **Step 2:** Run → FAIL → implement the code + `requirePollToken` (resolve the `cloud_poll` printer by `poll_id`, `verifySecret(token, poll_token_hash)`). PASS. Commit. `git commit -s -m "feat(server): requirePollToken + printer.poll_unauthorized"`

---

### Task 3: Poll / fetch / ack verbs (claim, serve, ack, timeout-requeue)

**Prereq:** the Star CloudPRNT contract is pinned (Prerequisites) — quote the verbs/fields into this task.

- [ ] **Step 1:** Failing test:
```ts
it("claims the oldest queued job atomically, serves it, and acks done", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const p = await createCloudPollPrinter(tx, cfg);
  const { jobId } = await enqueuePrintJob(tx, cfg, p.id, bytes("X"));
  const claim = await cloudPoll(tx, cfg, p.id);              // POST poll
  expect(claim.jobReady).toBe(true); expect(claim.token).toBe(jobId);
  expect((await jobRow(tx, jobId)).status).toBe("printing");
  const payload = await cloudFetch(tx, cfg, p.id, jobId);    // GET
  expect(payload).toEqual(bytes("X"));
  await cloudAck(tx, cfg, p.id, jobId, "done");              // DELETE
  expect((await jobRow(tx, jobId)).status).toBe("done");
});
it("requeues a stale claimed job after the TTL", async () => { /* claimed_at old → next poll returns it to queued */ });
```
- [ ] **Step 2:** Run → FAIL → implement — `cloudPoll` = locking `UPDATE print_jobs SET status='printing', claimed_at=now() WHERE printer=$p AND status='queued' … RETURNING` (oldest first; real-PG double-poll race proven by deletion of the lock) + a pre-step that requeues `printing` jobs with a stale `claimed_at`; `cloudFetch` returns `payload` for the printer's own job; `cloudAck` → `done`/`failed`(requeue). Shape the responses to the pinned Star contract.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(printing): CloudPRNT poll/fetch/ack + claim-timeout requeue"`

---

### Task 4: HTTP — the CloudPRNT endpoint group + media type

- [ ] **Step 1:** Failing e2e — `POST /print-api/cloudprnt/:pollId` (poll), `GET …?token=` (fetch), `DELETE …?token=` (ack), each `requirePollToken`; a cross-printer token → 401; the media type is served per §3d.
- [ ] **Step 2:** Run → FAIL → implement the endpoint group in `print-api.ts` (mounted so the cloud/local server serves it), wiring Task 3's verbs; set the response media type. **§3d branch:** if the target Star printer accepts ESC/POS → serve `payload` verbatim; else add a `starMarkup()` renderer in `@waitron/printing` behind the same payload (decide from the pinned spec).
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(server): CloudPRNT HTTP endpoint group"`

---

### Task 5: Dashboard — `cloud_poll` printer config

- [ ] **Step 1:** Failing test — selecting `cloud_poll` on the printer form generates a `poll_id` + token (token shown once, hash stored) and displays the poll URL; `DashboardApi.createCloudPollPrinter` returns them.
- [ ] **Step 2:** Run → FAIL → implement (extend the Slice-A printer form; `printer.manage`). a11y both themes.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(dashboard): cloud_poll printer config (token + poll URL)"`

---

### Task 6: Fiscal grep, guards, backlog

- [ ] **Step 1:** H2 grep — the enqueue side (`enqueuePrintJob`, Slice B, the receipt hook) is unchanged; `record-sale.ts`/alta builders untouched. Record.
- [ ] **Step 2:** Guard sweep — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; root Vitest.
- [ ] **Step 3:** Flip `docs/backlog.md` — cloud_poll (Star CloudPRNT) **BUILT**; note Epson Server Direct Print remains a follow-up.
- [ ] **Step 4:** Commit. `git commit -s -m "docs(backlog): cloud_poll (Star CloudPRNT) built; chore: H2 grep"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2 `claimed_at` → T1; §3 poll/fetch/ack + auth → T2/T3; §3d media type → T4; §3a-c HTTP → T4; §6 dashboard → T5; §5 fiscal → T6. No gaps.

**2. Placeholder scan** — real test/impl throughout; the deliberate deferrals are the Slice-A re-verification + the **Star protocol pinning** (a hard Prerequisite/Task-3 step, not a vague TODO) + the media-type branch (§3d, decided from the vendor spec) + the `db:generate` number — all flagged.

**3. Type consistency** — `cloudPoll`/`cloudFetch`/`cloudAck` consistent T3→T4; `requirePollToken` + `printer.poll_unauthorized` consistent T2→T3/T4; `claimed_at` consistent T1/T3; `enqueuePrintJob` (Slice A) untouched. The claim-race + timeout-requeue are the load-bearing correctness proofs (T3).

**Known risk** (flagged): the **exact Star CloudPRNT fields are a vendor contract** — pinned against Star's published spec before Task 3 (CLAUDE.md §1), not coded from memory; the payload media type (ESC/POS vs Star markup) is resolved from that spec (§3d). The claim must be an atomic locking `UPDATE…RETURNING` or a double-poll double-serves (T3, proven by deletion).
