# Departmental tab transfers — implementation plan

> **For agentic workers:** implement each task with a failing behavioral test first. Use `superpowers:executing-plans` for inline work and the repository's branch finishing workflow.

**Goal:** Let a department request transfer of an open tab to another department's shared receiving desk, with one explicit acceptance that preserves prior orders and fiscal records.

**Architecture:** A venue-service request row records the pending destination, sender and current status. Acceptance runs in one transaction: it checks the latest tab and payment state, chooses a destination zone/table, and changes responsibility once. Persistent request rows drive receiving queues and live notifications; viewing or dismissing a notification never performs acceptance. The existing `/api/bills/:id/transfer` moves lines between bills and remains a separate operation.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest real database and browser projects.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md) §§7–9. The written spec, including §9's proposed details, is approved.

## Global constraints

- Build after A261 step 2's departments/zones and W97's profile admission/action gate. A department has one designated receiving profile and one shared incoming queue; every device currently using that profile sees it.
- Configure permitted destination departments directionally. Sending grants no browsing rights at the destination. The sender retains responsibility while pending and may withdraw; declining requires a reason. Do not infer desk attendance merely from a signed-in session.
- A tab has at most one pending destination. Acceptance checks the latest tab state, refuses a payment in progress, and applies once even when two receiving devices race. Settling or closing the tab withdraws the pending request.
- New service actions use the receiving zone; existing ordered lines keep their price, menu version and service context, and existing kitchen/preparation/pickup instructions stay unchanged. Do not reissue a fiscal invoice or silently move an existing table/party structure.
- Use one `withTransaction` per write, add classifications and generated constraints for new tables, and do not edit shipped migrations. Inspect changed UI in both themes and at phone width.

## File map and contracts

| Area | Starting point and responsibility |
| --- | --- |
| `packages/venue-service/src/schema/service.ts`, new transfer schema/migration/classification; new `department-transfers.ts` | Direction policy, receiving profile, pending request and one-time state transition |
| `packages/venue-service/src/operations.ts` | `order_service_contexts` and recorded line context; change future service ownership without rewriting history |
| `apps/server/src/till-api.ts`, new `department-transfer-api.ts`, payment/party helpers | Authenticated send, withdraw, accept and decline; guard latest bill/party/payment state |
| `apps/till/src/till-app.ts`, receiving queue and sending tab screens; live query source | Persistent pending count, request detail, notifications and sender status |

Proposed service: `requestDepartmentTransfer(tx, tabId, destinationDepartmentId, sender)` returns a request id; `acceptDepartmentTransfer(tx, requestId, receiver, destinationZoneId, tableId?)` returns the updated tab revision; `declineDepartmentTransfer` requires a reason; `withdrawDepartmentTransfer` requires the sender's department. Route names are new and must not reuse the existing line-transfer endpoint. The request status is the authority for the shared queue, not a notification read flag.

## Review focus

1. Two receiving devices racing to accept leave exactly one accepted request and one ownership change (Task 2).
2. A bill settled or payment started after the transfer was requested cannot be accepted from a stale view (Task 2).
3. A dismissed notification leaves the pending transfer visible and actionable (Task 3).
4. A transfer of a tab with sent kitchen work preserves preparation and pickup targets (Task 2).
5. A source operator cannot browse the destination's unrelated tabs after sending (Tasks 1 and 3).

---

### Task 1: Store direction rules and durable requests

**Files:** `packages/venue-service/src/schema/service.ts`, new `department-transfers.ts` and tests, migration/classification; manager routes and screen for destination/receiving-profile settings.

- [ ] Write real database tests for permitted A→B and refused B→A, missing/inactive destination, receiving profile not approved for B, one pending destination per tab, duplicate requests, and withdrawal while pending. Assert the original tab remains operable and visible to its source. Run the focused venue-service suite and confirm the new cases fail.
- [ ] Store directional policy, one receiving profile per department and durable request state with sender identity, destination, timestamps, reason and revision. Enforce one pending request per tab with a generated partial unique index. Validate the tab's current department and destination policy inside the same transaction as request creation; no destination read permission is granted to the sender.
- [ ] Generate the migration, run schema/constraint and upgrade guards with a populated tab, and commit with `git commit -s`.

### Task 2: Accept or decline against current tab state

**Files:** `packages/venue-service/src/department-transfers.ts`, `operations.ts`; `apps/server/src/department-transfer-api.ts`, `till-api.ts`, payment/party guards and focused tests.

- [ ] Write failing tests for two concurrent receivers, a changed tab after request, a payment in progress, a settled/closed tab, an invalid destination zone/table, decline with and without reason, withdrawal racing with acceptance, and a legitimate acceptance. Assert exact domain refusals and no partial writes. Read back tab, party/table links, service context, recorded lines, kitchen work and invoice references.
- [ ] In one transaction, re-read request, latest tab revision, payment state, destination zone/table and receiver's active profile/person; claim only a pending request, then update future service ownership and request state once. Preserve existing line contexts and already-issued fiscal records. Reuse existing table/party operations where they can meet the destination constraints; if a tab's current structure cannot be moved safely, refuse it with a domain error rather than mutating only some links.
- [ ] Rerun focused server/venue-service tests and a real-database race case; prove both the refusal and a legitimate neighboring operation. Commit with sign-off.

### Task 3: Shared receiving queue and sender updates

**Files:** `apps/server/src/department-transfer-api.ts`, till live-query/subscription source, `apps/till/src/till-app.ts`, receiving/sending screens, focused browser and a11y tests, localization.

- [ ] Write failing browser/route cases: every device using the receiving profile sees one persistent pending request and count; no other profile sees it; opening or dismissing a notification does not accept; acceptance/decline/withdrawal updates sender and all receivers; a disconnected receiver sees the request after reconnect. Show the latest outstanding work before acceptance.
- [ ] Expose the durable queue and status reads behind profile and person permissions. Publish a live update when state changes, but always reload the durable row after reconnect. Make the receiver choose the destination zone and optional table explicitly, with Save/Cancel and field-level refusals; show a decline reason and sender's pending/accepted/declined/withdrawn states. Do not label a desk attended without a defined presence signal.
- [ ] Run focused browser/a11y tests, inspect both themes and phone/desktop widths, and commit with sign-off.

### Task 4: Audit all lifecycle paths

**Files:** settlement/close paths in `apps/server/src/till-api.ts` and their tests; `docs/backlog.md`; any found missing consumer.

- [ ] Write failing cases showing settling or closing a pending tab withdraws its request; a stale receiving screen then refuses acceptance. Trace all tab-close, payment and reassignment paths, including direct routes, and assert the old source cannot create a second pending transfer after responsibility changed.
- [ ] Add the lifecycle hook inside the transaction that settles/closes the tab; keep alerts/notifications derived from durable request state. Run focused fiscal/order suites and verify no invoice is recreated. Update backlog, commit with sign-off, then run normal hook/current-head CI during `finish-branch`.
