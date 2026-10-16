# A669-1: Party allergy storage and operations

> **For agentic workers:** use superpowers:executing-plans inline. The campaign already authorises implementation, finish-branch and land-branch.

**Goal:** Store a party's allergy answer, allergic guests and whole-dish assignments, preserving them when drafts become orders and parties join or split.

**Architecture:** Three mutable venue-service tables, exposed through the generic venue-service seat. Server lifecycle functions call that seat inside their existing transaction. The party revision coordinates edits; later slices add routes, prompts, kitchen snapshots and notices.

**Tech stack:** TypeScript, Drizzle, SQLite, Vitest, existing `useVenueDb` fixtures.

**Spec:** [A669](../specs/2026-10-14-a669-allergy-at-the-table-design.md), slice 1 and the owner's split answer.

## Constraints and decisions

- No fiscal code, golden fixtures, money, permissions or drawer behavior changes.
- `party_allergy`, `party_allergy_guests`, `allergy_line_ticks` are `state`; only core tables are new foreign-key targets. The last editor is a plain person id, matching parties' actor fields, so identity remains outside this migration's prerequisites.
- Guests have stable ids, ordered positions, a trimmed nonempty Who of at most 40 characters, a nonempty validated A668 allergen map and an optional note bounded to 2000 characters. Printer control characters become spaces, as whole-order notes do.
- Saving No allergies clears guests and their ticks. Allergies with zero guests remains valid after deleting the last guest. Saves use the party's expected revision and advance it; no answer is represented by no row.
- Each tick names one guest and exactly one draft or working line. Unique indexes allow only one guest per dish. Operations check party ownership and reject extras child lines. No cross-party reassignment is inferred from a bill move; party joins and the specified table split are explicit operations.
- Joining parties appends the source guests in order and keeps ids/ticks. Answer precedence between an unanswered party and No allergies awaits the owner’s M1 decision. The current branch keeps No allergies in both join directions. Closing source parties' bills remain part of the surviving party family in existing core code.
- Split a table copies all guests, with fresh ids, to the new party and keeps the originals. Only ticks on the bill actually taken by the new party are retargeted to its guest copies. Splitting without a bill copies guests but no ticks.
- Draft submission supplies draft ids in the exact group/input order. After inserting working parent rows and before firing or printing HOLD work, the seat moves their ticks to the corresponding preassigned ids in `rows`, independent of the order returned by insertion. Existing group/output order does not establish that mapping.
- No routes or user-visible strings in this slice. Allergy changes will use party revision refreshes, already watched by the table screens; route wiring belongs to slice 2/3. Frozen kitchen copies and notices belong to slice 4.
- Migration must add only these tables/indexes; inspect generated SQL and run upgrade checks before making any reset claim.

## Review focus

- A stale save cannot clear another device's guests or assignments.
- Malformed ids, empty allergens, unknown kinds and another party's lines are refused before any state change.
- Partial and reordered draft groups retain each dish's own guest, including dishes with extras.
- Joining parties retains all guests even when both contain the same Who; copied split guest ids cannot accidentally move staying ticks.
- Both kinds of tick target are unique, cascade on deletion and survive same-party bill split, transfer and merge by line id.

## Tasks

- [x] **1. Data and operations, test first.** Create `party-allergy.test.ts`, observe missing tables/functions failing, then add schema, generated migration, classification, module contract types and the operations in `party-allergy.ts`. `readPartyAllergy`, `savePartyAllergy` and `setAllergyLineTicks` return/read literal snapshots; `moveAllergyDraftTicks`, `mergePartyAllergies`, `splitPartyAllergies` are transaction-owned lifecycle operations. Cover unanswered/none/allergies, guest edit/delete, stale revisions, malformed values, ownership and database constraints. Run venue-service's focused node suites and schema conformance. Commit signed off.
- [x] **2. Draft conversion, test first.** Extend `order-drafts.db.test.ts` using its existing real venue fixture. Observe ticks lost on submit, then pass draft ids through `PlaceGroupsInput` and move ticks immediately after `insertTabRound`. Test partial submission, group reordering, extras and rollback; existing draft/group checks remain. Commit signed off.
- [x] **3. Party lifecycle, test first.** Add `party-allergy.moves.test.ts` with the real party venue. Observe joins/splits failing to preserve ownership, then call the seat from `combineParties` and `splitTable`. Cover No allergies/unanswered combinations, staying and leaving bills, same-party bill split/transfer/merge. Commit signed off.
- [ ] **4. Integration and delivery.** Extend the service method inventory without removing existing keys; run named schema/classification/module graph/error guards and unedited protected fiscal suites. Narrow A669's backlog entry to remaining slices and document delivered contracts. Rebase, one installed Claude run-it whole-branch review, triage with red/green fixes, normal push hook and current-head CI. Land under the campaign main lock, install main dependencies and remove only this branch/worktree. Record exact merge CI and update the local campaign ledger.

## Implementation receipts and refinements

The new cases in `order-drafts.db.test.ts` use that suite's existing product, variant and extra setup. A first partial-submit run retained only the unsent tick; it now retains all three and maps reordered groups to the correct parent rows. The equal-dish join case first returned one quantity-two line; the merge now keeps both assigned lines and their original ids. Existing unassigned draft merging remains covered by the unchanged suite.

`replaceLines` updates retained rows rather than deleting and reinserting them because the tick foreign key cascades on deletion. Draft saves still mint new line ids as before; the later send routes must apply their submitted tick choices to the current saved ids in the send transaction. No stable-id API change is included here.

Working-line ownership includes the party's merged family, matching `partyFamily` in server `parties.ts`. The two party-ownership tests distinguish a merged ancestor from an unrelated party.

Focused predecessor upgrade preserves the seeded party, draft, working order, both line rows and existing triggers. The full upgrade walk initially refused to generate a nonempty allergen object for its new synthetic guest row: its generic text candidates include `{}` but no nonempty JSON object. Adding the missing fixture value `{"milk":{}}` to `CANDIDATES` made its four unchanged cases pass in an installed disposable checkout (122.54 s). This is fixture growth under the campaign queue’s standing exception: no guard algorithm or existing assertion changes.

## Validation commands

- `pnpm --filter @waitron/venue-service exec vitest run --project node src/party-allergy.test.ts src/schema/schema-conformance.test.ts src/service.test.ts`
- `pnpm --filter @waitron/server exec vitest run src/party-allergy.moves.test.ts src/order-drafts.db.test.ts src/party-table-actions.test.ts`
- `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/module-graph-honesty.test.ts scripts/classification-complete.test.ts scripts/alert-codes.test.ts scripts/errors-reachable.test.ts scripts/migration-upgrade.test.ts`
- `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` (unedited)
- Package coverage belongs to current-head CI; no duplicate whole-workspace local suite.

## Whole-branch review follow-up

One completed Claude run-it review, 341 seconds, retained outside the repository. Its M1 answer-precedence question is recorded in the campaign's questions file and blocks finishing/landing until answered. It changes whether an unasked party is prompted at Send, so this is an owner choice rather than an inferred safety policy.

The return-order probe initially swapped two guests. Mapping to preassigned ids passes even when the real insert's returned rows are reversed. The new rollback case verifies a failure injected after ticks move restores the original draft, answer/ticks, working lines, groups and ticket items; a replay case returns the first result with one line/group. Draft lines are written in one batch again, with retained ids updated only in their draft, position, quantity and merge flag. Closed parties refuse new tick assignments. Invalid allergens carry the guest's field path as `allergy.invalid`, with the catalogue cause retained as a log-only reason.

The character-limit finding keeps the specified party-name convention. The existing `normalisePartyName` and the allergy operation both count JavaScript string units: an isolated real-function probe accepts 20 emoji and refuses 21. Changing the shared text-length convention is outside this slice.
