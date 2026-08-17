# Printing subsystem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A central-managed, transport-pluggable printing subsystem — printers configured centrally, jobs queued to an outbox, and delivered by distributed local print agents (usb + network_tcp now), so printing never blocks a sale and works from local or cloud.

**Architecture:** `print_agents` (pairing-code auth) + `printers` (transport config) + a `print_jobs` outbox; `enqueuePrintJob` is a single INSERT (never blocks); an agent runtime pulls its jobs (locking `UPDATE…RETURNING`), pushes bytes via a `Transport` interface (usb/network_tcp, fake-sink-tested), and reports status; a `@waitron/printing` package holds the outbox, agent runtime, and an ESC/POS builder; central dashboard management. Reuses existing scrypt/pairing crypto — writes none.

**Tech Stack:** TypeScript, Drizzle + PostgreSQL (RLS), Hono, `node:crypto` + `node:net` (TCP), Lit + Vite, Vitest (+ browser), Testcontainers + PGlite.

**Spec:** [docs/superpowers/specs/2026-08-17-printing-subsystem-design.md](../specs/2026-08-17-printing-subsystem-design.md).

## ⛔ Prerequisites

Largely independent (no table-service dep). Re-verify: the crypto primitives `hashSecret`/`verifySecret` (`secret-hash.ts:24-48`), the pairing model (`passkey.ts:49-93`), the Bearer shape (`sync-api.ts:80-88`), the `booking-api`/`purchasing-api` `gated()` module pattern, `boot.ts:340-394` mounting, `permissions.ts:7-57` (+ `permissions.test.ts`), the RLS idiom (`0036`), `inmutabilidad`, `@waitron/ui`.

## Global Constraints

- **English identifiers** — `print_agents`, `printers`, `print_jobs`, `print_transport`, `usb_path`, `poll_id`, `ticket_scope`, `print_job_status`. No new `SPANISH_WORDS`. UI copy en/es.
- **Never block a sale/fire** (CLAUDE.md §5) — `enqueuePrintJob` is a single INSERT with **no network/hardware I/O**; all pushing is the async agent loop. A test pins this.
- **Reuse crypto, write none** — agent token = `randomBytes(32)` hashed via `hashSecret`, verified via `verifySecret` (`timingSafeEqual` inside); pairing code = high-entropy, `sha256`-indexed, single-use `DELETE…RETURNING`, TTL-from-`created_at`.
- **Domain codes** — `printer.not_found`, `printer.invalid_config`, `agent.not_found`, `agent.unauthorized`, `agent.pairing_invalid`, `agent.pairing_expired`. `import "./errors.js"`. Never renamed.
- **Permission** — new `printer.manage` (admin+manager); the agent API is device-authed (`requireAgent`), not permission-gated. **Churn:** `permissions.test.ts`.
- **Security review before merge** (Task 8).
- **Single-writer-per-row** — enqueuer owns creation; the pull path owns the `printing→done/failed` transition (§4). Do not build replication.
- **cloud_poll is out** (fast-follow) — build `usb` + `network_tcp`, but the enum/columns/outbox carry cloud_poll.
- **No back-compat / data-migration** (pre-production). **Migration number via `db:generate`.** Re-run `inmutabilidad`.
- **Coverage:** db, server, `@waitron/printing` → 98/98/98/95; dashboard → 95/95/90/88. Real-PG for RLS/races. `TESTCONTAINERS_RYUK_DISABLED=true`. Prove guards by deletion. Real-printer verification is **manual** (fake sink in tests).

## File Structure

**Created:** `packages/printing/` (`@waitron/printing`: outbox verbs, agent runtime, `Transport` + adapters, ESC/POS builder, errors); `packages/db/src/schema/{print-agents,printers,print-jobs}.ts` (+ `.rls.test.ts`); `packages/db/drizzle/<NNNN>_printing.sql` + `<NNNN>_printing_rls.sql`; `apps/server/src/{print-api.ts, print-agent-session.ts}`; `apps/dashboard/src/screens/printers-screen.ts` (+ tests).
**Modified:** `packages/db/src/schema/index.ts`; `packages/identity/src/permissions.ts` (+ test); `apps/server/src/{boot.ts, errors.ts}`; `apps/dashboard/src/{dashboard-app.ts, api/client.ts}`; `docs/backlog.md`; `migrations.manifest.json` / `english-only.ts` `GENERIC_PACKAGES` + `vocabulary-scope.test.ts` if `@waitron/printing` needs enrolling (Task 8 churn check).

---

### Task 1: Schema — agents, pairing codes, printers, jobs + enums + RLS

- [ ] **Step 1:** `print-agents.ts` (`print_agents` + `print_agent_pairing_codes`, §2a); `printers.ts` (`printers` + `print_transport` + `print_ticket_scope` enums, §2b); `print-jobs.ts` (`print_jobs` + `print_job_status` enum, §2c, `payload bytea`). Register in `index.ts`.
- [ ] **Step 2:** `db:generate` → verify (four tables + four enums). Note `<NNNN>`.
- [ ] **Step 3:** Custom `<NNNN+1>_printing_rls.sql` — FORCE RLS + policy + grants on all four (`SELECT,INSERT,DELETE` on pairing codes; `SELECT,INSERT,UPDATE` on the rest); the composite FKs (`printers.agent_id`→`print_agents`, `print_jobs.printer_id`→`printers`); the transport-fields CHECK. Register in `_journal.json`.
- [ ] **Step 4:** RLS tests (real-PG) — isolation + negative `WITH CHECK` on all four; prove FORCE by deletion.
- [ ] **Step 5:** Guards — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad` (all four `relforcerowsecurity=true`).
- [ ] **Step 6:** Commit. `git commit -s -m "feat(db): print_agents + printers + print_jobs schema with FORCE RLS"`

---

### Task 2: `printer.manage` + `printer.*`/`agent.*` codes

- [ ] **Step 1:** Failing test — `roleHasPermission("manager","printer.manage")` true, staff false; the six codes resolve to statuses. Run → FAIL.
- [ ] **Step 2:** Add `printer.manage` to `PERMISSIONS` + `MANAGER`/`ALL`; update `permissions.test.ts`; register the codes. PASS. Commit. `git commit -s -m "feat(identity): printer.manage + printer/agent error codes"`

---

### Task 3: Agent enrol + auth (`requireAgent`) — reuse crypto

**Interfaces:** `generateAgentCode(tx, cfg, { label }) → { code }`; `enrolAgent(tx, cfg, { code }) → { agentId, token }`; `requireAgent(deps, c) → { agentId }` (Bearer).

- [ ] **Step 1:** Failing test — generate → enrol mints a `verifySecret`-able token (never plaintext at rest); an unknown/consumed/expired code → `agent.pairing_invalid`/`_expired`; `requireAgent` accepts a valid Bearer, rejects a wrong/revoked one (`agent.unauthorized`).
- [ ] **Step 2:** Run → FAIL → implement (mirror the device-identity design exactly: high-entropy code, `sha256` lookup, locking `DELETE…RETURNING`, TTL; token `randomBytes(32).base64url` + `hashSecret`; `requireAgent` = Bearer parse + `verifySecret` against the active agent, `sync-api.ts:80-88` shape). Real-PG single-use race (proven by deletion of the lock).
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(printing): print-agent pairing enrol + requireAgent"`

---

### Task 4: `enqueuePrintJob` (the never-block outbox)

- [ ] **Step 1:** Failing test:
```ts
it("enqueues a queued job with no I/O", async () => {
  const tx = pgliteTx(); const cfg = testCfg();
  const p = await createPrinter(tx, cfg, { name: "Cocina", transport: "network_tcp", agentId, host: "10.0.0.9", port: 9100 });
  const noNet = spyOnNoSocketOpened(); // assert node:net never called
  const { jobId } = await enqueuePrintJob(tx, cfg, p.id, new Uint8Array([1,2,3]));
  expect((await jobRow(tx, jobId)).status).toBe("queued");
  expect(noNet).not.toHaveBeenCalled();   // never-block invariant
});
```
- [ ] **Step 2:** Run → FAIL → implement — a single INSERT (`status='queued'`), `printer.not_found` if absent. No socket, no wait.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(printing): enqueuePrintJob outbox (never blocks)"`

---

### Task 5: Agent runtime — pull → push (transports + fake sink) → report + ESC/POS builder

**Interfaces:** `Transport { send(printer, bytes): Promise<void> }` (`network_tcp`, `usb`, + a `FakeSink`); `runAgentOnce(deps)` (pull→push→report one batch); `esc` builder (`init`/`text`/`line`/`cut`/`kick`).

- [ ] **Step 1:** Failing test (fake sink):
```ts
it("pulls a queued job, pushes the exact bytes, and reports done", async () => {
  const sink = new FakeSink();
  await enqueuePrintJob(tx, cfg, printerId, esc().text("Mesa 4").cut().bytes());
  await runAgentOnce({ tx, cfg, agentId, transport: sink });
  expect(sink.written).toEqual([{ printerId, bytes: esc().text("Mesa 4").cut().bytes() }]);
  expect((await jobRow(tx, jobId)).status).toBe("done");
});
it("marks printing atomically so two agents don't double-print", async () => { /* real-PG double-pull race, proven by deletion of the locking UPDATE */ });
it("retries a failed push and doesn't block another printer's queue", async () => { /* … */ });
```
- [ ] **Step 2:** Run → FAIL → implement: the ESC/POS builder (`packages/printing/src/escpos.ts`); the `Transport` interface + `NetworkTcpTransport` (`node:net` socket to `host:port`), `UsbTransport` (write to `usb_path`), `FakeSink` (records bytes); `runAgentOnce` = locking `UPDATE print_jobs SET status='printing' WHERE printer in (agent's) AND status='queued' RETURNING` → `transport.send` per job → `POST result` (`done`/`failed`, `attempts++`, backoff on failure). Real hardware is manual; tests use `FakeSink`.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(printing): agent pull/push/report runtime + transports + ESC/POS builder"`

---

### Task 6: HTTP — agent API + management API + mounting

- [ ] **Step 1:** Failing e2e — agent: `POST /print-api/agent/enrol` (unauth), `GET /print-api/agent/jobs` + `POST /print-api/agent/jobs/:id/result` (`requireAgent`; a revoked agent → 401); management: agent-codes + printers CRUD + a job list, `printer.manage` (401/403/manager, gate by deletion).
- [ ] **Step 2:** Run → FAIL → implement `print-api.ts` (`mountPrintApi`: the unauth enrol route, the `requireAgent` agent group, the `gated("printer.manage")` management group — the `purchasing-api` shape); `requireAgent` in `print-agent-session.ts`; mount in `boot.ts`; `printer.*`/`agent.*` in the `STATUS` maps.
- [ ] **Step 3:** Prove both gates by deletion. PASS, coverage. Commit. `git commit -s -m "feat(server): print-api agent + management routes"`

---

### Task 7: Dashboard Impresoras screen

- [ ] **Step 1:** `DashboardApi` — `listAgents`/`createAgentCode`/`revokeAgent`, `listPrinters`/`createPrinter`/`updatePrinter`/`deactivatePrinter`, `listRecentJobs`, `testPrint(printerId)`. Stub-test → implement → PASS.
- [ ] **Step 2:** Failing screen tests — agents (enrol code shown once · revoke · last-seen); printers CRUD incl. `printer.invalid_config` (missing transport fields → `role="alert"`); a **test-print** button enqueues a known payload; job/printer status renders. Run → FAIL → implement (list+form pattern; register `"printers"` in the shell). a11y both themes.
- [ ] **Step 3:** PASS, coverage. Commit. `git commit -s -m "feat(dashboard): Impresoras (agents + printers + status) screen"`

---

### Task 8: Security review, fiscal grep, guards, backlog

- [ ] **Step 1:** **Security review** (the `security-review` skill or an adversarial pass): agent token never logged/returned except once at enrol; `verifySecret`/`timingSafeEqual` used (no `===`); pairing single-use + TTL + a redemption rate-limit; revoke immediate; the pull `UPDATE…RETURNING` prevents double-print; an agent can only pull **its own** printers' jobs (cross-agent 403/empty). Fix findings.
- [ ] **Step 2:** Fiscal grep — `grep -rn "print" packages/core/src/record-sale.ts packages/fiscal-verifactu/src/backend.ts` → zero hits; plus the never-block test (Task 4) is green. Record in the commit.
- [ ] **Step 3:** Guard sweep — `pnpm --filter @waitron/db test:coverage` (unfiltered); `inmutabilidad`; `pnpm lint && pnpm typecheck && pnpm format:check`; root Vitest. **Churn:** `@waitron/printing` is a new package — add to `english-only.ts` `GENERIC_PACKAGES` + update `vocabulary-scope.test.ts` if it pins the list; it's a plain Node package (auto `test-light`), no manifest change (schema is in `packages/db` core).
- [ ] **Step 4:** Flip `docs/backlog.md` — printing subsystem **BUILT**; note `cloud_poll` (fast-follow), Slice B (KDS kitchen printing), and the receipt/cash-drawer consumers remain.
- [ ] **Step 5:** Commit. `git commit -s -m "chore(security): printing review; docs(backlog): printing subsystem built"`

---

## Self-Review (completed at plan-writing time)

**1. Spec coverage** — §2a agents/pairing → T1/T3; §2b printers → T1; §2c outbox → T1/T4; §3a enrol/auth → T3; §3b enqueue → T4; §3c agent runtime + transports → T5; §3d ESC/POS → T5; §3e cloud_poll → out (spec §1); §4 topology/single-writer → T4/T5 (ownership); §5 never-block → T4; §6 dashboard → T7; §7 permission/codes → T2; §8 security/testing → T5/T8. No gaps.

**2. Placeholder scan** — real test/impl throughout; deferrals are `cloud_poll` (fast-follow, spec-scoped out), multi-node replication (spec §4), the `db:generate` number, and manual real-printer verification — all flagged.

**3. Type consistency** — `enqueuePrintJob(printerId, bytes)` consistent T4→T5→T7; `Transport.send`/`FakeSink` defined once (T5); `requireAgent → { agentId }` consistent T3→T5→T6; `printer.manage` + the six codes consistent T2→T3→T4→T6; the outbox `status` values `queued/printing/done/failed` consistent T1/T4/T5. The never-block invariant is asserted (T4) and structurally enforced (enqueue = INSERT only).

**Known risks** (flagged): the pull must be an atomic locking `UPDATE…RETURNING` or two agents double-print (T5, proven by deletion); `print_jobs` multi-node sync is deferred (single-node works, §4); real-printer bytes are verified manually (fake sink in CI). Security review (T8) gates merge.
