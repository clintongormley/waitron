# Forward-only scheduled menu publication — implementation plan

> **For agentic workers:** implement each task with a failing behavioral test first. Use `superpowers:executing-plans` for inline work and the repository's branch finishing workflow.

**Goal:** Queue fixed menu editions for future activation without ever taking a menu backwards.

**Architecture:** `@waitron/catalogue` creates each immutable version when it is queued and stores a separate activation schedule; the version id already exists when a device reads it. A primary-node local duty advances the live pointer. The read path resolves the latest due version at one instant even if that duty is late. The timetable selects a menu id; this branch selects that menu's edition.

**Tech Stack:** TypeScript, Drizzle/SQLite, Hono, Lit, Vitest database and browser projects.

**Spec:** [Devices, menus and service zones](../specs/2026-10-04-devices-menus-and-service-zones-design.md) §§3, 8–9. The written spec, including §9's proposed details, is approved.

## Global constraints

- Work after the department-menu branch (W98) so scheduled editions use the same live-menu read contract. Keep menu timetable periods separate from publication activation times.
- A queued edition captures the previewed document and image references now; later draft edits do not change it. Version numbers never go backwards or get reused after cancellation. Immediate publication overtaking queued editions requires explicit cancellation/replacement in the same transaction.
- In the venue time zone, reject a nonexistent local time and require the chosen occurrence for a repeated local time. Store normalized instants; a restart makes the latest due edition live without presenting overdue editions one by one.
- Activation is local database work, never dependent on a remote service. It cannot alter prior sale lines or already issued fiscal records. A future public menu uses the same edition resolver but this branch does not build the public site.
- New tables get classification, generated constraints, append-only declarations where appropriate and migration guards. Do not edit shipped migrations. Inspect changed UI in both themes and at phone width.

## File map and contracts

| Area | Starting point and responsibility |
| --- | --- |
| `packages/catalogue/src/menu-publication.ts`, `schema/publication.ts`, new migration and classification | Current `previewMenu`, `publishMenu`, `menuVersions`, `menuPublications`; add scheduled activation rows over immutable versions |
| `packages/catalogue/src/menu-document-types.ts`, `index.ts`, media image-reference paths | Expose queued/live status and keep queued snapshot images available until cancellation/activation policy permits release |
| `apps/server/src/catalogue-api.ts`, `boot.ts`, new publication duty | Authenticated queue/cancel/reschedule/immediate routes; primary-only local activation and restart recovery |
| `apps/dashboard/src/screens/menus-screen.ts`, `api/client.ts` | Preview, schedule, queue and explicit overtake decision in English and Spanish |

Proposed seam: `queueMenuPublication(tx, menuId, expectedHash, activationInstant, personId)` stores the exact preview document as a new immutable `menuVersions` row and a separate schedule row; `resolveLiveMenuVersion(tx, menuId, at)` returns the latest effective version id/document; `activateDueMenuPublications(tx, at)` advances stored pointers monotonically. The implementer must trace all current `menuPublications`, `menuVersions.publishedAt`, `menuStatus` and media consumers before changing their meaning. Set `publishedAt` to the intended activation instant and keep the queue timestamp on the schedule row; scheduled versions must not appear live before that instant. Reserve edition numbers across live and queued versions, including cancelled ones. Do not use an updatable draft as a queued edition.

## Review focus

1. A draft edit after queueing cannot change the scheduled edition or its photos (Task 1).
2. Several overdue activations after restart expose only the latest due edition (Task 2).
3. An immediate publish cannot leave a lower-number queued edition that later reverts the live menu (Task 2).
4. Clock-change input cannot silently select the wrong occurrence (Task 3).
5. A concurrent queue/publish operation cannot duplicate a number or move the live pointer backwards (Tasks 1–2).

---

### Task 1: Store fixed queued editions

**Files:** `packages/catalogue/src/schema/publication.ts`, `menu-publication.ts`, new migration, classification, media references, focused tests.

- [ ] Write a real database test: preview version 4, queue it, edit the draft and replace its image, then assert the queued document/hash/images remain the previewed ones. Queue two editions and assert distinct increasing reserved numbers; cancel one and assert its number is not reused. Run the focused catalogue suite and confirm the new cases fail.
- [ ] Create the immutable `menuVersions` row and its `menuVersionImages` at queue time, with a scheduled-publication row naming that version, chosen UTC activation instant, request identity and state. Keep `menuPublications` pointing only at the effective live version; filter queued versions out of existing live/status reads until due. Enforce same-menu uniqueness and monotonic numbering within one transaction. Media already references `menuVersionImages`; verify its retention path before relying on that row for queued images.
- [ ] Generate the migration, run schema/constraint/append-only guards and the focused catalogue suite, then commit with `git commit -s`.

### Task 2: Activate in order and recover after restart

**Files:** `packages/catalogue/src/menu-publication.ts` and tests; `apps/server/src/boot.ts`, new publication duty and failed-start/restart tests; `apps/server/src/catalogue-api.ts`.

- [ ] Write failing cases for due editions 4–6 activated in sequence, a restart after editions 4 and 5 are overdue, concurrent activation attempts, an immediate publish before a queued edition, and an immediate publish overtaking one. Assert the live pointer never decreases, an overtaken queue is refused until the manager explicitly cancels or replaces it, and existing sale lines keep their version.
- [ ] In one transaction, mark due schedule rows consumed and advance `menuPublications` to the highest due eligible version without a backward intermediate pointer. Return the effective due version id on reads even when the duty has not run yet, so order-line foreign keys still name `menuVersions`; keep the local duty responsible for recording the pointer and notifying live clients. Put its stop on `undoOnFailure` as soon as it starts and make it primary-only.
- [ ] Run focused catalogue/server tests, including real boot restart and an intentionally late duty; verify its status and image retention. Commit with sign-off.

### Task 3: Schedule and cancel through management routes

**Files:** `apps/server/src/catalogue-api.ts` and route tests; `apps/dashboard/src/api/client.ts`; catalogue publication operations.

- [ ] Write failing route tests for stale preview hash, unauthorized person, invalid date/time, nonexistent spring clock time, both autumn occurrences, a queued edition before the live number, explicit cancellation/rescheduling, and immediate publish with and without an overtake decision. Assert a refused request writes nothing.
- [ ] Parse local input against the venue time zone, require an explicit offset/occurrence when ambiguous, and store a normalized instant. Expose queue/status/cancel/reschedule operations behind the existing menu publication permission. Perform the preview-hash check and schedule write in one transaction.
- [ ] Rerun focused route and catalogue suites and commit with sign-off.

### Task 4: Show queued and live states in Menus

**Files:** `apps/dashboard/src/screens/menus-screen.ts`, `api/client.ts`, focused browser/a11y tests and localization; `docs/backlog.md`.

- [ ] Write failing browser cases for multiple queued editions, each number/time/status, cancellation and rescheduling, changed draft after queueing, and an immediate publish that requires a clear cancel/replace decision. A stale preview or failed request retains the form and points to the field or decision.
- [ ] Add the controls using shared form primitives; distinguish draft, queued and live content and show the chosen local occurrence. Keep W87–W95's menu navigation and Preview behavior intact. Run focused tests and visual checks in both themes at phone/desktop width; update the backlog and commit with sign-off.
- [ ] During `finish-branch`, run the normal pre-push gate and verify current-head CI coverage, migration checks and the primary-only duty's failed-start behavior.
