# A1378 kitchen paper implementation plan

> **For agentic workers:** use superpowers:executing-plans inline, the method required by this
> campaign. Steps use checkbox syntax. No implementer/reviewer pair per task.

**Goal:** Finish the owner's approved kitchen-paper bundle in its one existing branch and PR.

**Architecture:** Pure paper renderers receive explicit context. Transactional producers gather
party/bill/station work once, then reuse existing printer routes. Existing notice rows retain their
original bill and dish attribution; optional context in their existing JSON groups a party event.

**Tech stack:** TypeScript, Drizzle/SQLite, Vitest, ESC/POS raster output and the existing preview.

**Spec:** [Approved design](../specs/2026-11-06-a1378-kitchen-paper-design.md).

## Constraints

No table/schema/migration changes, no fiscal writer or golden changes, no new location concept.
Signed-off commits, test first, one bundle/PR. New fixed words need watcher approval before landing.
Native inline implementation is already selected by RUNNER; owner approved all six choices.

## Review focus

- A shared printer must not apply FIRE to an unrecorded station; test both orderings and all-held.
- Same-name parties and simultaneous counter changes must stay separate; test actual notice rows.
- Acknowledgment must cover every bill's rows without consuming another party's notice.
- A name change must exclude served, made-here and never-printed held work; test positive/negative.
- Identical dishes in different groups or measured portions must not combine on MOVED.

### Task 1: Initial paper fixes (already implemented)

- [x] Observe old UTC/whole-number/boundary failures; require explicit venue zone on four formats.
- [x] Fix measured extras, host-zone fixture expectations, wrapping and change-slip test gaps from
  the first 837-second Claude review. All 39 affected files pass 1,869 tests with `TZ=UTC`.
- [x] Six new one-time mutation controls fail assertions; restored 122 cases pass.
- [x] Correct the redundant escaped space reported by the first normal push hook's lint step.

### Task 2: FIRE scope, named corrections and MOVED grouping

Files: `kitchen-ticket.ts`, `kitchen-print.ts`, `kitchen-ticket.paper.test.ts`,
`kitchen-print.shared-printers.test.ts`, `move-merge.test.ts` and existing correction suites.

- [x] Add failing shared-printer cases: recorded Grill, unrecorded Bar, both station orders. Keep
  the original whole-ticket HOLD check and a single-station FIRE check. Observe assertion failure.
- [x] Add `mark?: "FIRE"` to `KitchenTicketStation`; multi-station producer sets that mark per
  recorded station and renderer prints the existing banner within that section. Keep single/global
  HOLD behavior. Run the focused cases to green.
- [x] Add a failing correction whose surviving party is Ana: `Order 17 · Ana` / `Pedido 17 · Ana`.
  Add optional `party` context to `CorrectionSlip`, resolve names once, and render like a ticket.
  Retain unnamed headers. Run the correction cases.
- [x] Add failing MOVED cases for two identical whole portions (one `2 x`), separate (two `1 x`),
  measured/sold-as-recorded entries and distinct groups. Arrange all fired items and each held
  group's items together, rather than arranging individual lines. Keep all link/state assertions.
- [x] Run focused suites and commit with `git commit -s`.

### Task 3: One party kitchen-note event

Files: `kitchen-print.ts`, `kitchen-ticket.ts`, shared `KitchenNoteChange` type,
`packages/venue-service/src/kitchen-notices.ts`, their tests and note-change integration suites.

- [x] Add failing two-bill party cases: one output listing both order numbers; one displayed notice
  per station; acknowledgment covers every underlying bill row. Add same-name other-party and
  separate counter-order controls. Observe the expected duplicate-paper/notice failures.
- [x] Gather affected bills by surviving party identity (counter by order), retaining original rows.
  Move the ORDER NOTE CHANGED renderer branch into a batch helper, resolving all line items once.
  `KitchenNoteChangeSlip` gains optional party context and an order-number list for grouped output.
- [x] Add optional `partyId` context to `KitchenNoteChange` and a note-event option for shared time
  and combined order label. Fold party events by typed context identity/time/before/after in the
  existing read and acknowledgment key. No SQL schema change. Per-output order numbers reflect
  only the bills whose dishes it prints. Run positive/negative and acknowledgment cases to green.
- [x] Run single-bill note, lifecycle, measured and visibility tests; commit signed off.

### Task 4: Name-change paper

Files: `parties.ts`, `till-api.ts`, `kitchen-print.ts`, `kitchen-ticket.ts`,
`i18n/kitchen-ticket.ts`, direct callers and party/name integration tests.

- [x] Add failing rename, first-name and clear-name cases with two bills and shared/separate
  printers. Assert old/new names and exact affected order lists. Add unchanged normalized name,
  no work, served work, made-here and unrecorded HOLD controls.
- [x] Add `formatPartyNameChangeSlip` with station names, table label, order numbers, before/after,
  instant, locale and explicit venue zone. Add the four proposed bilingual fixed words.
- [x] Add `enqueuePartyNameChange` using existing party-family and outstanding printed-work reads.
  Read the old name and enqueue after saving in the same transaction. Identity-only paper does
  not need trading context; retain the existing signature and rollback/revision assertions. Run to green.
- [x] Commit signed off; update EN/ES kitchen guides and affected historical/decision prose.

### Task 5: Finish the whole bundle

- [ ] Refresh EN/ES 58/80mm raster previews for all new paper; inspect them and send samples and
  exact wording to the watcher. Keep images/probes outside Git. Wait for wording approval to land.
- [ ] Remove completed bundle entries from both backlog files; move approved enduring decisions
  to their area's decisions section. Register all deliberately changed test checks in the PR/FYI.
- [ ] Run focused affected suites under UTC and contrasting zones, appropriate root/module guards,
  and the unedited fiscal golden/inmutability suites. Keep all counts and failure controls.
- [ ] Review the substantial new owner-approved work in one installed disposable Claude candidate;
  retain the first review and repairs. Fix accepted findings in this PR, then normal hook and
  current-head package coverage CI. No whole-workspace local package run solely for finishing.
- [ ] Re-read queue/questions before finishing and landing. Land only after wording approval and
  green current-head checks, holding H11's lock for the entire land-branch operation. Record exact
  merge CI, refresh main/install and remove only this worktree and its local/remote branch.
