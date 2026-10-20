# A758 — Voids and comps: the rules, then a page of their own: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** for A758-1 (who may approve a comp or a cancel is an auth-and-permissions
change; a migration; a cross-package contract between the server, the till and the dashboard). The
later pull requests say their own path. Implementers are dispatched as `subagent_type:
"implementer"`. An implementer that passes about 150 tool calls with its task unfinished stops at a
passing or cleanly failing point, commits, and hands over: done, left, files, each check's state.

**Goal:** a venue's reasons are of two kinds, Void and Comp. A Comp reason says who can apply it and
who can approve it as lists of roles, and its limits ask an approver instead of refusing; the bill's
limit is a euro amount of comps with its own approver list; a cancel is judged by the refund
permission, not by its reason. A new venue starts with nine reasons. Then the reasons get a page of
their own under Service, the report groups Voids and Comps, and a full comp prints "Descuento 100%".

**Architecture:** the rules are pure functions in `packages/adjustments/src/policy.ts`
(`evaluateComp`, `evaluateCancel`, `approves`), fed by the server's plan of the adjustment
(`apps/server/src/adjustments-apply.ts`), which works out the numbers they need from the bill. The
reason and settings tables change shape through generated migrations in the adjustments set. The
till's preview answer names which list must approve, and the till fetches that list.

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, drizzle-kit 0.31.11, Hono routes, Lit (the
dashboard and the till), Vitest (node and browser projects).

**Spec:** `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md` (the design; D1–D28
in its §1). Pictures: `docs/backlog/mockups/a758-adjustment-reasons/` — 01 the list page, 02 the edit
form, 03 the cancel and its PIN prompt, 04 past a limit, 05 the receipt. Backlog: `docs/backlog.md`
"A758" (line 2128 on `8d1cc0caa`) and `docs/backlog/till.md` "## A758" (line 1377).

All file references are to `main` at `8d1cc0caa` (this branch's base) unless they name lane G's
branch `origin/feat/a773-1-unsent-list` at `e118de96e` (pull request #1897, open). Every line number
below was read on 2026-10-19 with `sed -n`/`grep -n` in this worktree unless marked otherwise.

---

## The pull requests

| PR | Branch | Scope | Migration | Files it shares with A773-1 |
|---|---|---|---|---|
| **A758-1** (this plan, in full) | `feat/a758-1-reason-rules` | The rules: reason kind, Comp role lists, limits that ask, item limit, bill comp limit in euros, cancels by the refund permission, nine starter reasons, import refusal (D27), demo seed, the till's approval prompts, the dashboard's reason form and bill-limit section | yes (adjustments set: reasons and settings reshaped; **venue reset**) | 25 |
| **A758-2** | `feat/a758-2-voids-and-comps-page` | The page: Service → Voids and comps, search, drag handles, the list of picture 01, a real Delete through `wt-delete-dialog`, `active` dropped | yes (reasons: `active` dropped; venue reset where a switched-off reason exists) | 8 |
| **A758-3** | `feat/a758-3-voids-and-comps-report` | The report: By kind as Voids and Comps, each entry's words, By reason's Asked by and Approved by, the entries' Reason filter | no | 0 |
| **A758-4** | `feat/a758-4-full-comp-receipt` | Receipts print "Descuento 100%" for a full comp; the `comp` receipt label goes | no | 9 |
| **A758-5** | `feat/a758-5-comp-window-words` | The till's Comp window and actions under D10's names; "Comp the bill" with Free; Spanish "Invitar" goes. **Starts only after A773-1 has landed** | no | (all its till files; re-count at start) |

The overlap counts are from these commands, run on 2026-10-19:

```bash
git -C /Users/clintongormley/workspace/repos/waitron diff --name-only main...origin/feat/a773-1-unsent-list > /tmp/a773.txt   # 532 files
grep -Fxf /tmp/pr1.txt /tmp/a773.txt | wc -l   # /tmp/pr1.txt = A758-1's file list below → 25
```

A758-1's shared files: `apps/server/src/{adjustments-api.ts, adjustments-api.test.ts,
adjustments-apply.ts, adjustments-apply.test.ts, adjustments-bill-payments.test.ts,
default-cancel-reason.test.ts, former-numbers.test.ts, made-here.routes.test.ts,
receipt-language.test.ts, split-off-extras.split.test.ts, till-api.ts, testing/adjustment-venue.ts,
testing/cancel-line.ts}`, `apps/till/src/{api/client.ts, api/client.test.ts, i18n/codes.ts,
i18n/strings.ts, screens/till-table-order-screen.a11y.test.ts, till-app-adjustments.test.ts,
till-app-counter-adjustments.test.ts, till-app.ts, widgets/adjustment-dialog.ts,
widgets/test-helpers.ts}`, `docs/backlog.md`, `docs/backlog/till.md` (counted before the review
added Tasks 8b and 10b, whose sweeps touch more server suites; re-count at the rebase). A758-2's (the same command over its file list): `apps/dashboard/src/i18n/strings.ts`,
`apps/server/src/till-api.ts`, `apps/till/src/{i18n/codes.ts, till-app.ts, widgets/adjustment-dialog.ts}`
(retiring `adjustment.reason_inactive`), `docs/developers/design-system.md` and the two backlog files. A758-4's:
`apps/server/src/{receipt-document.ts, receipt-document.test.ts, receipt-adjustments.test.ts,
adjustments-apply.test.ts, adjustments-bill-payments.test.ts}`,
`apps/till/src/screens/{till-ticket-view.ts, till-ticket-view.test.ts}`, and the two backlog files.
A773-1 touches nothing under `packages/adjustments` (the diff above lists no such path).

**Order and A773-1.** Whoever lands second rebases (owner waiver). Design §9 "Order against A773-1":
A758's rules change who approves behind A773-1's dialogs, not their shape, so either can land first.
To keep the shared files late, A758-1's tasks run package-only work first (Tasks 1–5), then the
dashboard (Tasks 6–7), then the server and till (Tasks 8–11). **Before Task 8, check
`gh pr view 1897 --json state`: if A773-1 has merged, rebase this branch on `main` first** and read
"What A773-1 changes that A758-1 must adapt" below. A758-3 shares nothing and may run in another lane
at any time after A758-1 (it reads the reason kind A758-1 adds only through the action, so it could
even go first; it is ordered third for review load). A758-5 waits for A773-1.

**What A773-1 changes that A758-1 must adapt, if A773-1 lands first** (read on `e118de96e`):

- `apps/server/src/line-cancel.ts` (new on that branch) reads `reason.active`,
  `reason.actions.includes("cancel")` and `policySnapshotOf` for "Cancel, still charge", and calls
  `applyAdjustment` with `action: "cancel"` for "Cancel, don't charge" of a started dish. Under
  A758-1 "still charge" checks `reason.kind === "void"` and takes no approval; "don't charge" goes
  through `evaluateCancel` (Task 10), which asks for the refund permission because the dish is
  started (stage `fired` or `served`).
- The single Comp window (A773-1 Task 16) shows "Can apply: {apply} · If approval is needed:
  {approve}" from `applyRole`/`approverRole` (its strings `comp.policy`, `comp.role_*`). A758-1
  removes those fields from `GET /api/adjustment-reasons` and sends `applyRoles`/`approverRoles`:
  the summary names each list (roles joined with ", ", "Everyone" for all four).
- `adjustments-api.ts` gains `POST /api/parties/:id/drafts/:did/discard` and exports
  `approverToCheck`; `adjustments-apply.ts` gains `expectedEdit`, `sourceDraftId`,
  `preparationStarted` and recalled-draft handling. None of these touch the approval lines A758-1
  changes (`planAdjustment`'s verdict, `previewAdjustment`, `approvedBy`), so the rebase is by hunk.
  `line-cancel.ts` reaches `applyAdjustment` only for a dish it counts as started (`started =
  context.stage === "started" || ask.preparationStarted === true`, `:114` on `e118de96e`), so
  Decision 2's stage rule asks the refund permission there with no change.
- **The till's approval path on that branch reads `needsApproval` as a role** (read on `e118de96e`
  with `git show origin/feat/a773-1-unsent-list:apps/till/src/till-app.ts`): the Cancel item
  dialog's approval calls `listAdjustmentApprovers(preview.needsApproval)` (`:11594`); a recalled
  draft's discard combines several cancel previews by the highest role and ORs
  `overBillDiscountLimit` (`:12059-12060`); a discard refused `adjustment.approval_required` takes
  the approver from `params.approverRole` (`:12247-12261`). Under A758-1 a cancel's approval is
  `{ by: "refund" }` or null, so the combination becomes "the first non-null", the list call becomes
  `listRefundAuthorizers()`, and the refusal is read through `params.approval`. Twenty test files
  that branch changes add lines naming `applyRole`, `approverRole`, `needsApproval` or
  `approval_required` (counted 2026-10-19 by grepping each file's added lines in `git diff
  main...origin/feat/a773-1-unsent-list`), among them `line-cancel.test.ts`, `draft-discard.test.ts`, `draft-recall*.test.ts`,
  `till-app-drafts.test.ts`, `cancel-item-*.test.ts`, `finish-table-dialog*.test.ts`,
  `adjustment-dialog.combined*.test.ts`); each translates by the fixture rule. Whoever lands second
  budgets a task for this.

**Out of scope, each a later slice not planned here** (design §9 and §10): A758's slice for §3.8
after A773-1 lands — the refund screen filled in with the refund-to-cancel link and its Reason
drop-down (D26), the cash switch removed on the till and the server (D24, §3.8.2), the
preparation-started flag on `adjustments` and the report's «En preparación», "Void, charged" and
"Refunded …" columns, Table finished on the pass card, the finished party's zone with its refusing
case; "They'll collect it at the counter" (§3.8 item 4); A908. **Decided from the design:** the
unpaid not-started removal with no reason and no `adjustments` row (§10 item 1) and the "Cancel,
still charge" €0.00 row (§10 item 3) are A773-1's: §10 says "A773-1 (lane G): what Cancel item… and
Finish table build", and its item 6 lists what is A758's, which names neither. A773-1's branch
already builds both (`line-cancel.ts` on `e118de96e`: the `!started` branch removes with
`removeFromLine` and no adjustment; the `else` branch writes `recordAdjustment` with no reduction).
**Decisions by where they land:** D14, D15, D17, D18, D21, D23 and D25 are A773-1's dialogs (design
§10) or A758's §3.8 slice; D19's per-cancel columns, D20, D24, D26 and D28 are the §3.8 slice; D8 is
retired. Every other D-number lands in A758-1 to A758-5 below.

---

## Global constraints

- **Pre-live: no backwards-compatibility or data-migration code** (CLAUDE.md §3). Migrations are
  generated with `pnpm --filter @waitron/adjustments db:generate`, never hand-written or hand-edited,
  numbers assigned by generation; a `--custom` migration is hand-written and is not used.
- **A758-1 needs a venue reset; its PR's first line says so:** "Needs a venue reset: adjustment
  reasons change shape and cannot be carried." A reason today mixes actions and holds one role per
  field (`packages/adjustments/src/schema/reasons.ts:32-36`); no generated statement can turn that
  into a kind and two lists, and translating it would be data-migration code.
- **The filed record does not change.** No task touches `computeHuella`, the chain, invoice-number
  allocation, `registros_facturacion` or the alta builders. Every PR runs, unedited:
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
  Design §8 concluded by reading, not by a run, that no receipt label reaches a filed record: the
  alta is built at `packages/fiscal-verifactu/src/backend.ts:219-235` from amounts, rates and the
  operation description, and nothing under `packages/fiscal-verifactu`, `packages/fiscal` or
  `packages/core` imports the receipt labels. A758-4's Task re-checks it with a run (a full comp's
  filed record before and after the label change compared byte for byte). A comp changes amounts
  exactly as today; no task changes what a comp or a cancel takes off.
- **Changing an existing test's assertion is a stop**, unless this item's design changes what it
  checks (owner, 2026-10-05). Each PR lists every such change under "Changed test checks" with the
  file, the case and the design point; growing a fixture (a field it lacks, a role an operator
  needs) is listed under "Fixtures grown". Anything else that turns red is a stop and a report.
- **Fixture translation rule (A758-1).** A fixture reason with `applyRole: R, approverRole: A`
  becomes a Comp reason with `applyRoles` = R and every role above it and `approverRoles` = A and
  every role above it (`staff` → all four; `supervisor` → supervisor, manager, admin; `manager` →
  manager, admin; `admin` → admin). Today's approval is `roleAtLeast` against one role
  (`apps/server/src/adjustments-apply.ts:724`, `packages/adjustments/src/policy.ts:110`), so those
  lists answer every comp the same way, and today's operations refuse an approver below the applier
  (`operations.ts:95`), so the new "on the approve list asks nobody" rule changes nothing for them.
  A fixture reason allowing `cancel` and comp actions together becomes two reasons, a Void and a
  Comp. A cancel-only fixture reason becomes a Void reason (no lists, no limits). **A Comp reason
  offering Free under an item limit below 100% is refused** (design §3.1; Task 4's `reasonValues`),
  and four shared fixtures are exactly that, `comp` with `maxPercentBp: 5000`:
  `packages/adjustments/test/seed.ts:31` (`seedReason`), `apps/server/src/testing/adjustment-venue.ts:207`
  (Complaint), `apps/server/scripts/demo-seed/seed-adjustments.ts:74` (the demo's Complaint) and
  `apps/server/src/configuration-transfer.test.ts:1859`. They are not the only ones: `git grep -nE
  "maxPercentBp: [0-9]" -- apps packages` on 2026-10-19 also finds suite-local reasons offering
  `comp` under a limit below 10000 in, among others, `operations.test.ts`, `policy.test.ts`,
  `record.test.ts`, `routes.test.ts`, the reasons-screen tests, `adjustments-apply.test.ts:1325`
  and the till's `adjustment-dialog.a11y.test.ts`. Each loses its item limit
  (`maxPercentBp: null`), as the design's own Complaint has none (§4); a case that tests the item
  limit moves to a reason that does not offer Free (Task 8's Staff meal fixture). That is a fixture
  change, listed under "Fixtures grown", not a changed check.
- **Who may is a risk trigger.** Every permission rule a task adds or changes gets a refusing case
  AND the legitimate case still served, at the server route as well as in the pure function.
- **Words.** Product text is quoted from the pictures where they draw it, and is otherwise as short
  as the meaning allows. Each task names its strings in English and Spanish. Spanish for the kinds
  and the till's actions follows D10: Void «Cancelar», Comp «Descuento»; the page «Cancelaciones y
  descuentos». The dashboard's Spanish word for a role is «rol» (`packages/adjustments/src/dashboard/strings.ts:211-212`).
- **Forms** follow `docs/developers/design-system.md` → Forms and A331's save rule
  (`draftScopeFor`, `saveActionState`, an early return in the save handler, a `*.unsaved.test.ts`);
  fields come from field primitives (`wt-input`, `wt-price-input`, `wt-combobox`,
  `wt-segmented-control`, `wt-switch`); colours and spacing read `--wt-*` tokens.
- **User guides:** no guide page describes adjustments or reasons. `git grep -il "reason\|give
  away\|discount" -- apps/server/src/guide` finds only `en/content-and-images.md`, whose one hit
  (`:103`) is an upload failure's reason. So no task updates a guide; if a later PR adds a guide page,
  it runs `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.
- **Coverage** 98/98/98/95 holds in every package touched. Local runs are focused; CI runs the
  package suites (owner rule). Every commit `git commit -s`, staging explicit paths.
- **Do not touch** lane G's branch or worktree.

### Guard suites, by kind of change

- **Schema or migration:** `pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
  scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts
  scripts/migrations-match-schema.test.ts scripts/migration-upgrade.test.ts
  scripts/journal-monotonic.test.ts` and `pnpm --filter @waitron/fiscal-verifactu exec vitest run
  src/inmutabilidad.test.ts`. Run `scripts/migration-upgrade.test.ts` with `AI_AGENT` and
  `CLAUDECODE` unset to read its output.
- **A new or retired error code:** `pnpm exec vitest run scripts/alert-codes.test.ts
  scripts/errors-reachable.test.ts`, and `git grep -n "<code>"` across `apps packages` to find every
  copy (CLAUDE.md §3: a rename or a retirement moves every copy in one change).
- **A changed wire shape:** `git grep -n "<field>" -- '*.test.ts'` for every field added or removed,
  to find each test pinning the whole shape with `toEqual` (a name-filtered run does not load them,
  CLAUDE.md §2).
- **Dashboard or till strings:** the package's `strings.test.ts`/`codes.test.ts`, and
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts`.

---

## Decisions (with receipts)

1. **The rules' order for a comp** (design §3.2, D1–D7). Given one request under one Comp reason:
   (a) refused when the reason is switched off (`adjustment.reason_inactive`), is not a Comp reason or
   does not offer the action (`adjustment.action_not_allowed`), or lacks a required note
   (`adjustment.note_required`); (b) **past the bill's comp limit** — the bill's comps before it plus
   its reduction above the venue's amount — someone on the venue's "Who can approve past it" asks
   nobody, anyone else needs a PIN from that list; (c) otherwise someone on the reason's "Who can
   approve it" asks nobody; (d) otherwise someone not on "Who can apply it", or a request past the
   reason's item or bill limit, needs a PIN from "Who can approve it"; (e) else allowed. Checked
   against the worked example (design §3.2, picture 04): Ana (staff) €25 → (d) reason list; Luis
   (supervisor) €25 under €30 → (e); Luis €50 past €40 → (b) bill list; Marta (manager) €50 → (b),
   on the list, allowed. Reaching a limit exactly is within it, as today (`policy.ts:97`, `:103` use
   `>`).
2. **A cancel's rule on `main`** (D12, D13): needs the refund permission (`sale.refund`, held by
   supervisor, manager and admin, `packages/identity/src/permissions.ts:46-55`) when the dish's stage
   is `fired` or `served`, and nobody when it is `unsent` or `held`. Today every cancel through the
   adjustment path takes the dish off an unpaid bill (`removeFromLine`,
   called at `apps/server/src/adjustments-apply.ts:838` in `applyAdjustment`), which is "Cancel,
   don't charge"; held and unsent dishes are "just removed" by anyone (D12). `main` has no
   "Has preparation started?" question, so a fired dish counts as possibly started: stricter than
   D12 until A773-1's dialog asks (A773-1 then removes a not-started dish without this path,
   `line-cancel.ts` `!started` branch on `e118de96e`). Recorded as Open point 1.
3. **The item limit ("Most off one item", D4)** counts, per item, the basis points this reason has
   taken: each earlier row of the reason on the item, or on a row it was split from at any remove,
   adds `ceil(reduction × 10000 ÷ nominal_value)`; each earlier row of the reason on the whole bill
   adds the same to every item on the bill; the request adds its own the same way (a bill-level
   request: each changed row's reduction over that row's list value). A dish and its extras follow
   today's rule for percentages (`priorsOf`, `adjustments-apply.ts:566-596`: an extra also counts its
   dish's share, a dish the largest any of its extras took), now for every comp action. **A comp of
   part of a line counts on the part it carved off, not on the rest of the line.** Its row is
   recorded on the line it carved from (`id: line.id`, `apps/server/src/adjustments-apply.ts:860`
   in `applyAdjustment`) with the carved row as a split's `to`, and today's lineage query counts a
   row on its recorded line too: `record.test.ts:244-264` pins `carved` (the rest) still carrying
   the 20% taken off `carvedAgain` (its synthetic rows record a whole quantity, so the rule below
   leaves that case as it is). Under D4 ("everything that reason took off that item") a Staff
   meal 50% on one of two burgers on a line would then make the other burger ask for its own 50%.
   So a line-level row whose `quantity` is less than its `line_quantity` counts only on the rows its
   `splits` name as `to` and their descendants; every other row counts as today. Ceiling rounding
   and counting a bill comp against items added after it both err toward asking (Open point 2). No migration: `reduction` and `nominal_value` are on every row
   (`schema/adjustments.ts:72-74`); today's `readLinePercents` sums `percent_bp` only
   (`record.ts:113-134`), which is why a €12 amount took a burger to €0 under a 20% cap (design §2.2).
4. **The bill's comp limit** (§3.5, D6) counts what comps took off the items still on the bill:
   Σ over the bill's rows of `max(0, list value − price)` at the row's quantity. Cancelled rows are
   gone, so their comps leave the count; free items count (a free item is a comp, D5). It replaces
   `maxBillDiscountBp` and `shareOf` (`adjustments-apply.ts:607-625`), which left comps out.
5. **Stored shapes.** `adjustment_reasons` gains `kind` (`void` | `comp`), `apply_roles` and
   `approver_roles` (JSON lists of role keys, the four built-in keys A7 will keep, design §7) and
   loses `apply_role`, `approver_role`. `actions` stays: a Void reason's is `["cancel"]`, a Comp
   reason's a non-empty subset of `comp`, `discount_percent`, `discount_amount` — the stored actions
   stay as design §3.4 says (renaming one means changing the append-only `adjustments` table's check,
   `schema/adjustments.ts:89`). `adjustment_settings` loses `max_bill_discount` and gains
   `max_bill_comp` (cents, nullable) and `bill_approver_roles` (JSON list, default
   `["manager","admin"]`). `active` stays in A758-1 and goes in A758-2 with the real Delete.
6. **No CHECK can validate a JSON list's members** (`packages/db/src/schema/sales.ts:147`: "A CHECK
   may not hold a `json_each` subquery"), so membership in the role vocabulary and the
   kind-to-actions match are the operations' (`reasonValues`, `operations.ts:76-106`); the table
   checks what it can: the kind's vocabulary, a Void reason's empty lists and limits, a Comp reason's
   non-empty lists.
7. **The till learns which list must approve.** `AdjustmentPreview.needsApproval` becomes
   `null | { by: "reason"; roles } | { by: "bill_limit"; roles; limit } | { by: "refund" }`;
   `overBillDiscountLimit` goes. The till fetches `GET /api/adjustment-approvers?roles=…` for the
   first two and the existing `GET /api/refund-authorizers` (`apps/server/src/bill-payments-api.ts:262-270`,
   till `listRefundAuthorizers`, `apps/till/src/api/client.ts:2810-2814`) for the third.
8. **Error codes.** `adjustment.over_limit` retires: limits ask now (D3), so nothing returns it.
   `adjustment.approval_required`'s params change from `{ approverRole }` to
   `{ approval: "reason" | "bill_limit" | "refund" }`. New: `adjustment_reason.void_required`
   `{ withNote: boolean }` — the venue would be left with no switched-on Void reason, or none that
   asks for a note (D27, design §6). The import refuses with the existing `setup.request_invalid`
   `{ field: "adjustment_reasons" }`, as `validateCatalogueConfiguration` does
   (`packages/catalogue/src/configuration-transfer.ts:75-81`).
9. **The policy snapshot** recorded on each adjustment (`policySnapshotOf`, `policy.ts:204-213`) takes
   the new shape: `{ kind, actions, maxPercentBp, maxAmount, applyRoles, approverRoles,
   noteRequired }`. Nothing reads it back: `git grep -n "policySnapshot\|policy_snapshot" -- apps
   packages ':!*.test.ts'` finds only the writer chain (`adjustments-apply.ts:873`, `record.ts:62`,
   the schema). It is JSON, so no migration.
10. **The till's approval words (picture 03 and design §3.2).** Comp: "Someone who can approve
    {reason} must enter their PIN." / «Alguien que pueda autorizar «{reason}» debe introducir su
    PIN.»; past the bill limit (picture 04): "This takes the bill's comps past {limit}. Someone who
    can approve past the bill's limit must enter their PIN." / «Con esto, los descuentos de la cuenta
    pasan de {limit}. Alguien que pueda autorizar por encima del límite debe introducir su PIN.»;
    cancel: "Someone who can give refunds must enter their PIN." / «Alguien que pueda hacer
    devoluciones debe introducir su PIN.» The PIN prompt (`override.*`, `apps/till/src/i18n/strings.ts:417-420`)
    is reworded in English as picture 03 draws it: "Approve with PIN", "Choose who approves", "Enter
    their PIN", and "Nobody available to approve"; the Spanish already says «responsable»
    (`:1995-1998`) and stays. The Comp window keeps "Ask for approval" (design §3.2, our choice there).

---

## Review focus

1. **A staff cancel of a held dish on `main`** must still go straight through with no PIN (D12) —
   pinned in Task 10 beside the fired-dish refusal.
2. **A comp asked by someone on "Who can approve it" but not on "Who can apply it"** goes straight
   through (D1: "someone on the second list asking for it themselves goes straight through") —
   pinned in Task 2 and Task 8.
3. **A second comp under the same reason on the same item** (Staff meal 50%, then another 20%) asks
   for approval even when each alone is within the limit; and an amount comp counts by its share of
   the item, not as 0% (design §2.2's €12-amount case) — pinned in Task 3 and Task 8.
4. **The last Void reason, and the last one that asks for a note,** cannot be switched off, turned
   into a Comp or (for the note) have its note switched off; another Void reason that asks for a note
   frees "Other" — pinned in Task 4; the import's same rule in Task 5.
5. **A role list sent with a duplicate, an unknown role or nothing** is refused at the management
   route naming its field, and the form never sends one — pinned in Task 4 and Task 6.

---

# A758-1 — the rules (this branch)

**Files (create / modify):**

- `packages/adjustments/src/schema/reasons.ts`, `schema/settings.ts`, their `*.test.ts`,
  `src/migrations.test.ts`, `drizzle/00NN_*.sql` and `drizzle/meta/*` (generated)
- `packages/adjustments/src/policy.ts`, `policy.test.ts`, `errors.ts`
- `packages/adjustments/src/record.ts`, `record.test.ts`
- `packages/adjustments/src/operations.ts`, `operations.test.ts`, `settings.ts`, `settings.test.ts`,
  `routes.ts`, `routes.test.ts`, and `packages/adjustments/test/seed.ts` (outside `src/`)
- `packages/adjustments/src/provisioning.ts`, `provisioning.test.ts`,
  `configuration-transfer.ts`, `configuration-transfer.test.ts`
- `packages/adjustments/src/dashboard/client.ts`, `client.test.ts`, `reasons-screen.ts`,
  `reasons-screen.test.ts`, `.unsaved.test.ts`, `.save-state.test.ts`, `.a11y.test.ts`, `strings.ts`
- `packages/identity/src/staff.ts`, `index.ts`, new `staff.list-active-with-roles.test.ts`
- `apps/server/src/adjustments-apply.ts`, `adjustments-api.ts`, `till-api.ts`, their tests,
  `testing/adjustment-venue.ts`, `testing/cancel-line.ts`, the fixture tests named in Task 8,
  `scripts/demo-seed/seed-adjustments.ts` and its test, `configuration-transfer.test.ts`
- `apps/till/src/api/client.ts`, `till-app.ts`, `widgets/adjustment-dialog.ts`,
  `widgets/test-helpers.ts`, `i18n/strings.ts`, `i18n/codes.ts`, their tests
- `apps/dashboard/src/dashboard-app.test.ts` (one mocked settings answer, `:74`)
- `scripts/migration-upgrade.test.ts` (a `RESETS` entry, and `CANDIDATES` only if the walk asks)
- `docs/backlog.md`, `docs/backlog/till.md`

Between Task 2 and Task 11, `apps/server` and `apps/till` do not typecheck and their adjustment
suites are red; each task names what it makes green. Vitest transpiles without typechecking, so a
package's own focused tests run throughout.

## Task 1: the reason and settings tables take the new shape

**Files:** `packages/adjustments/src/schema/reasons.ts`, `schema/settings.ts`,
`schema/reasons.test.ts`, `schema/settings.test.ts`, `src/migrations.test.ts`, generated
`drizzle/*`, `scripts/migration-upgrade.test.ts`, `packages/adjustments/test/seed.ts`.

**Interfaces — Produces:** `adjustmentReasons` with `kind: ReasonKind` (`enumType(["void",
"comp"])`, not null), `applyRoles: json<PersonRoleValue[]>("apply_roles").notNull().default([])`,
`approverRoles: json<PersonRoleValue[]>("approver_roles").notNull().default([])`; `applyRole` and
`approverRole` gone. `adjustmentSettings` with `maxBillComp: money("max_bill_comp")` and
`billApproverRoles: json<PersonRoleValue[]>("bill_approver_roles").notNull().default(["manager",
"admin"])`; `maxBillDiscount` gone. Export `REASON_KINDS`/`ReasonKind` from `schema/reasons.ts` (the
schema may not import `policy.ts` for a value it declares; `adjustments.ts:19` imports from
`policy.js`, so either direction is the existing pattern — keep the vocabulary where `enumType` is
called).

Checks (each declared by name in the TypeScript schema, so a regeneration carries them; CLAUDE.md
§3):

- `adjustment_reasons_kind_ck`: `enumCheck(t.kind)`
- `adjustment_reasons_kind_fields_ck`: `(kind = 'void' and json_array_length(apply_roles) = 0 and
  json_array_length(approver_roles) = 0 and max_percent is null and max_amount is null) or (kind =
  'comp' and json_array_length(apply_roles) > 0 and json_array_length(approver_roles) > 0)`
- drop `adjustment_reasons_apply_role_ck`, `adjustment_reasons_approver_role_ck`
- `adjustment_settings_max_bill_comp_ck`: `max_bill_comp is null or max_bill_comp > 0`
- `adjustment_settings_bill_approver_roles_ck`: `json_array_length(bill_approver_roles) > 0`
- drop `adjustment_settings_max_bill_discount_ck`

- [ ] **Step 1: Write the failing tests.** In `schema/reasons.test.ts` and `schema/settings.test.ts`,
  the declaration lists name the new checks and not the dropped ones. In `src/migrations.test.ts`:
  - "creates adjustment_reasons with the kind and both role lists, and no single-role columns"
    (`pragma_table_info` has `kind`, `apply_roles`, `approver_roles`; not `apply_role`,
    `approver_role`).
  - "refuses a Void reason with a role list or a limit, and a Comp reason with an empty list" (four
    inserts each refused with `CHECK constraint failed: adjustment_reasons_kind_fields_ck`; a
    well-formed Void and a well-formed Comp accepted).
  - "refuses a kind outside void and comp".
  - "adjustment_settings has an optional amount and a never-empty approver list, Manager and Admin
    to start" (a row inserted with only `id` and `updated_at` reads `bill_approver_roles` as
    `'["manager","admin"]'`; `max_bill_comp` 0 refused; `bill_approver_roles` `'[]'` refused).
- [ ] **Step 2: Run them, expect FAIL** —
  `pnpm --filter @waitron/adjustments exec vitest run src/migrations.test.ts src/schema --project node`
  → the new cases fail on missing columns and checks.
- [ ] **Step 3: Change the schema and generate in two steps** (CLAUDE.md §3: a drizzle-kit 0.31.11
  generation that rebuilds a table must not also add a column to it):
  1. Add only the new columns, `kind` without `.notNull()` for now and without any new check;
     `pnpm --filter @waitron/adjustments db:generate`. The file must hold only `ALTER TABLE … ADD`
     statements. If it rebuilds anything, stop and report.
  2. Make `kind` not null, add the new checks, drop the old columns, their checks and
     `max_bill_discount`; generate again. Each table must be rebuilt once
     (`__new_adjustment_reasons`, `__new_adjustment_settings`), with no `ADD` in the same file. If
     not, stop and report.
  Before shipping a rebuild, list the foreign keys pointing at both tables (CLAUDE.md §3): none —
  `git grep -n "adjustment_reasons\|adjustment_settings" -- '**/drizzle/*.sql' | grep -v
  "^packages/adjustments"` printed nothing on 2026-10-19, and `adjustments.reason_id` holds no key
  (`schema/adjustments.ts:60-62`). Neither table has an expression index. Neither is append-only
  (`classification.ts:5-19`).
- [ ] **Step 3b: Keep the seed helper writable.** `seedReason` (`packages/adjustments/test/seed.ts:24-37`, its doc comment and body)
  writes through `createAdjustmentReason`, which still writes the single roles until Task 4, and
  every `adjustments`-table case in `src/migrations.test.ts` but its column list (`:183`) calls it
  (`adjustmentRow`, `:111-114`), as do most `src/record.test.ts` cases. So in this task it inserts its row directly
  (`db.insert(adjustmentReasons)`) in the new shape — a Comp reason, the three comp actions, no
  item limit (fixture rule), `maxAmount` €30.00, apply Supervisor, Manager, Admin, approve Manager,
  Admin — and returns that reason with `kind`, `applyRoles` and `approverRoles`. Task 4 points it
  back at `createAdjustmentReason`. Fixture grown.
- [ ] **Step 4: Run the tests, expect PASS** (same command). Then the schema guards and
  `inmutabilidad` (Global constraints). Fix nothing in a guard.
- [ ] **Step 5: Measure the upgrade.** `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run
  scripts/migration-upgrade.test.ts`. **What the failing case prints:** the second step refused with
  `NOT NULL constraint failed: __new_adjustment_reasons.kind`, because the walk carries a reason row
  whose nullable `kind` it left null (the file's own description, `scripts/migration-upgrade.test.ts:41-43`:
  "A nullable column outside every unique index is null wherever its constraints allow"). That is
  the reset this PR's first line names. Add `"adjustments/<second tag>": { refused: ["NOT NULL
  constraint failed: __new_adjustment_reasons.kind"] }` to `RESETS` with a one-line comment
  ("Reasons change shape; every venue needs a reset (A758)"), using the message the run printed if it
  differs. If the walk instead cannot write a row a new check allows, add `CANDIDATES` for that
  column (allowed; the PR description says which and why). Re-run: `Tests … passed`. A control:
  with the `RESETS` entry removed the walk fails naming the step.
- [ ] **Step 6: Commit** — `git add` the schema files, the tests, the generated `drizzle/` files and
  `scripts/migration-upgrade.test.ts` and `test/seed.ts`; `git commit -s -m "Adjustment reasons get a kind and two role
  lists; the bill limit becomes an amount (A758)"`.

**Changed test checks:** `src/migrations.test.ts:84` ("refuses a role outside the ladder in either
role column" — the columns go, D1), `:345` and `:365` (the settings' one limit in basis points — D6),
`:54` (the reasons' column list), the two declaration tests (`schema/reasons.test.ts:7`,
`schema/settings.test.ts:7`, their check lists). **Fixtures grown:** the raw reason row `insert`
writes (`src/migrations.test.ts:26-45`, a Complaint offering `comp` with single roles) takes
`kind` and the two lists, and the limit cases at `:89` write a Comp row; `seedReason` (Step 3b).

## Task 2: the rules as pure functions

**Files:** `packages/adjustments/src/policy.ts`, `policy.test.ts`, `errors.ts`.

**Interfaces — Produces** (in `policy.ts`; `billDiscountNeedsManager`, `billCancelNeedsManager`,
`BillDiscountRequest`, `BillCancelRequest`, `BillShare`, `AdjustmentRequest` and
`evaluateAdjustment` are deleted):

```ts
export const COMP_ACTIONS = ["comp", "discount_percent", "discount_amount"] as const;
export type CompAction = (typeof COMP_ACTIONS)[number];
export interface AdjustmentReason {
  id: string; name: string; names: Record<string, string>;
  kind: ReasonKind; actions: AdjustmentAction[];
  maxPercentBp: number | null; maxAmount: Decimal | null;
  applyRoles: PersonRoleValue[]; approverRoles: PersonRoleValue[];
  noteRequired: boolean; active: boolean; position: number;
}
export type Approval =
  | { by: "reason"; roles: PersonRoleValue[] }
  | { by: "bill_limit"; roles: PersonRoleValue[]; limit: Decimal }
  | { by: "refund" };
export type AdjustmentVerdict =
  | { kind: "allowed" }
  | { kind: "needs_approval"; approval: Approval }
  | { kind: "refused"; code: "adjustment.action_not_allowed" | "adjustment.note_required" | "adjustment.reason_inactive" };
export interface CompRequest {
  action: CompAction; reduction: Decimal; actorRole: PersonRoleValue; note: string | null;
  /** This reason's earlier reductions on the bill. */
  priorReductionOnBill: Decimal;
  /** The most basis points any item this request changes would then carry from this reason. */
  itemShareBp: number;
  /** What comps have taken off the items still on the bill, before this request. */
  billComped: Decimal;
  billLimit: { maxAmount: Decimal | null; approverRoles: PersonRoleValue[] };
}
export function evaluateComp(reason: AdjustmentReason, req: CompRequest): AdjustmentVerdict;
export interface CancelRequest { actorRole: PersonRoleValue; note: string | null; stage: AdjustmentStage }
export function evaluateCancel(reason: AdjustmentReason, req: CancelRequest): AdjustmentVerdict;
export function approves(approval: Approval, role: PersonRoleValue): boolean;
export interface AdjustmentPolicySnapshot {
  kind: ReasonKind; actions: AdjustmentAction[]; maxPercentBp: number | null; maxAmount: Decimal | null;
  applyRoles: PersonRoleValue[]; approverRoles: PersonRoleValue[]; noteRequired: boolean;
}
```

`evaluateComp` follows Decision 1, in that order. `evaluateCancel`: switched off → `reason_inactive`;
`kind !== "void"` or `!actions.includes("cancel")` → `action_not_allowed`; note → `note_required`;
stage `fired` or `served` and `!roleHasPermission(actorRole, "sale.refund")` → `{ by: "refund" }`;
else allowed (Decision 2). `approves`: membership for `reason`/`bill_limit`,
`roleHasPermission(role, "sale.refund")` for `refund`. A malformed request (a negative amount, a
negative or fractional `itemShareBp`) throws `RangeError`, as `assertWellFormed` does today
(`policy.ts:65-77`). `errors.ts`: retire `adjustment.over_limit`; `adjustment.approval_required`
becomes `{ approval: Approval["by"] }`; add `adjustment_reason.void_required: { withNote: boolean }`.

- [ ] **Step 1: Write the failing tests** in `policy.test.ts`, one `describe` per function, with the
  design's worked example as fixtures (Complaint: apply Supervisor/Manager/Admin, approve
  Manager/Admin, `maxAmount` €30; bill limit €40, Manager/Admin):
  - "Ana, staff, asks for one €25 Chuletón free: someone on Who can approve it" →
    `{ kind: "needs_approval", approval: { by: "reason", roles: ["manager", "admin"] } }`
  - "Luis, supervisor, €25 within €30 goes straight through" → `{ kind: "allowed" }`
  - "Luis, €50 past €30 and the bill's €40: someone on Who can approve past it" →
    `approval: { by: "bill_limit", roles: ["manager","admin"], limit: decimal("40.00") }`
  - "Marta, manager, €50: on both approval lists, straight through"
  - "someone on Who can approve it but not Who can apply it goes straight through" (Review focus 2)
  - "past the item limit asks the reason's approver, never refuses" (`itemShareBp` 5001 under
    `maxPercentBp` 5000; exactly 5000 is allowed)
  - "past the reason's bill amount asks, never refuses" (`priorReductionOnBill` 20 + 10.01 under 30)
  - "reaching the bill's comp limit exactly passes; one cent past asks"
  - "a bill comp limit of none never asks"; "a Void reason asked to comp is refused
    action_not_allowed"; "a Comp reason without An amount refuses an amount"; "a missing required
    note is refused before any approval is asked"; "a switched-off reason is refused"
  - `evaluateCancel`: "staff cancel a held or unsent dish with nobody's PIN" (Review focus 1);
    "staff cancelling a fired or served dish need the refund permission" → `{ by: "refund" }`;
    "a supervisor cancels a fired dish alone"; "a Comp reason cannot cancel"; "a Void reason's
    required note"
  - `approves`: refund approval accepts supervisor, manager, admin and refuses staff; a list
    accepts exactly its members
  - `policySnapshotOf`: keeps the seven fields, copies both lists and the actions (a later edit of
    the reason's arrays does not reach the snapshot), and nothing that names or orders the reason.
- [ ] **Step 2: Run, expect FAIL** —
  `pnpm --filter @waitron/adjustments exec vitest run src/policy.test.ts --project node`.
- [ ] **Step 3: Implement** the functions and types above; delete the retired ones.
- [ ] **Step 4: Run, expect PASS**; then the error-code guards (Global constraints) and
  `git grep -n "adjustment.over_limit"` to list the copies Tasks 8 and 11 remove (`apps/server/src/till-api.ts:607`,
  `apps/till/src/i18n/codes.ts:580`, `apps/till/src/widgets/adjustment-dialog.ts:74`).
- [ ] **Step 5: Commit** — `git commit -s -m "Comp rules by role lists and limits that ask; cancels by the refund permission (A758)"`.

**Changed test checks** (`policy.test.ts`, all D1–D7 and D13): `:78` ("refuses a 60% discount under a
50% limit" — now asks, D3), `:89` (percentage-only priors — now every comp counts, D4), `:124`
("counts a cancel's reduction against the bill limit" — cancels have no limit, D13), `:164` ("never
measures a comp against the percentage limit" — now it does, D4), `:56`, `:148` (approval named by
one role — now a list, D1), `:230` (refusal before approval: kept for the note only), and the whole
`billDiscountNeedsManager` (`:259-310`) and `billCancelNeedsManager` (`:311-425`) describes, retired
with their functions (D6, D13).

## Task 3: what a reason has already taken off an item

**Files:** `packages/adjustments/src/record.ts`, `record.test.ts`.

**Interfaces — Produces:** `readReasonItemShares(tx, { workingOrderId, reasonId, lineIds }):
Promise<Map<string, number>>` (basis points per line id, Decision 3) replacing `readLinePercents`;
`ReasonTotals` becomes `{ priorReductionOnBill: Decimal; priorItemShareBp: number }` and
`readReasonTotals` fills `priorItemShareBp` from `readReasonItemShares`. Keep the lineage CTE of
`record.ts:119-132`; select each lineage row's distinct adjustment rows' `reduction` and
`nominal_value` (no `sum` in SQL: the ceiling is per row), plus the reason's bill-level rows once,
and sum `Math.ceil(reduction * 10000 / nominal)` in integer cents (a row with `nominal_value` 0
adds 0). A row that carved (`quantity` < `line_quantity`) counts only where the seed's lineage
reaches one of its splits' `to` rows (Decision 3). The `splits` doc comment that names
`readLinePercents` (`schema/adjustments.ts:47-48`) takes the new name. Cents fit: a reduction of at most `999999999` cents (the route's 9 digits,
`routes.ts:60`) times 10000 is below 2^53.

- [ ] **Step 1: Failing tests** in `record.test.ts` (real venue, `useVenueDb`): "counts a free item
  as 10000"; "counts a €3.00 amount off a €12.00 item as 2500"; "rounds a share up: €1.00 off €3.00
  is 3334"; "adds a row split off the item, at any remove"; "adds the reason's comp on the whole
  bill to every item"; "leaves out another reason's rows and another bill's"; "adds nothing for a
  cancel" (a Void reason's rows have their own reason id, so this is the other-reason case with a
  cancel row); "counts a comp of one of two burgers on the burger it carved off, not on the other"
  (a row with `quantity` "1", `line_quantity` "2" and a split to the carved row: the carved row
  reads 10000, the line it was recorded on 0; Decision 3). Then one real-path case in
  `apps/server/src/adjustments-apply.test.ts` (Task 8's "cumulative limits"): Staff meal 50% on
  one of two Burgers on one line, then 50% on the other, goes straight through for staff.
- [ ] **Step 2: FAIL** — `pnpm --filter @waitron/adjustments exec vitest run src/record.test.ts --project node`.
- [ ] **Step 3: Implement.** **Step 4: PASS.**
- [ ] **Step 5: Commit** — `"An item's limit counts everything its reason took off it (A758)"`.

**Changed test checks:** the `readLinePercents` cases in `record.test.ts` (it counted percentages
only; D4 counts every comp) — list each by name.

## Task 4: reasons and settings are edited in the new shape

**Files:** `packages/adjustments/src/operations.ts`, `operations.test.ts`, `settings.ts`,
`settings.test.ts`, `routes.ts`, `routes.test.ts`, `packages/adjustments/test/seed.ts`.

**Interfaces — Produces:**
`AdjustmentReasonInput = { name; names; kind: ReasonKind; actions; maxPercentBp; maxAmount;
applyRoles: PersonRoleValue[]; approverRoles: PersonRoleValue[]; noteRequired }`;
`AdjustmentSettings = { maxBillComp: Decimal | null; billApproverRoles: PersonRoleValue[] }`
(no row reads as `{ maxBillComp: null, billApproverRoles: ["manager", "admin"] }`). Wire: the
management routes send and take `kind`, `applyRoles`, `approverRoles` and, for settings,
`maxBillComp` (a money string as `maxAmount` is, `routes.ts:60`, or `null`) and
`billApproverRoles`.

`reasonValues` (`operations.ts:76`) refuses `adjustment_reason.invalid` naming the field when: a Void
reason's `actions` is not exactly `["cancel"]` (`actions`), or it has a role or a limit (that
field); a Comp reason's `actions` is empty, repeats one, or includes `cancel` (`actions`); a list is
empty, repeats a role or names one outside `personRole.enumValues` (`applyRoles` /
`approverRoles`); `maxPercentBp` below 10000 while `actions` includes `comp` (`maxPercentBp`; design
§3.1: "A Comp whose most off one item is under 100% cannot offer Free"). The approver-below-applier
refusal (`operations.ts:94-95`) goes. **The Void guards** (Decision 8), checked inside the same
transaction after the change would be made, counting switched-on reasons only:
`updateAdjustmentReason` and `deactivateAdjustmentReason` refuse `adjustment_reason.void_required
{ withNote: false }` when the reason changed is a switched-on Void reason and no switched-on Void
reason would remain, and `{ withNote: true }` when it is one that asks for a note and none that asks
for a note would remain. A change to a Comp reason is never refused by this guard, so a fixture
venue holding no Void reason can still edit its Comp reasons. Routes: `requireReasonInput` (`routes.ts:103-114`) reads the new
fields with `requireEnum` per list member (refusing `management.request_invalid` naming
`applyRoles`/`approverRoles` for a non-array, a member outside the roles, or a duplicate — Review
focus 5); the settings `PUT` takes both fields, both required; `STATUS` maps
`adjustment_reason.void_required` to 409.

- [ ] **Step 1: Failing tests.** `operations.test.ts`: a Void and a Comp created and read back; each
  refusal above by field; "refuses to switch off the last Void reason"; "refuses to turn the last
  Void reason into a Comp"; "refuses to switch the note off on the last Void reason that asks for
  one, and allows it once another Void reason asks for a note" (Review focus 4); "allows Other to be
  switched off while another Void reason asks for a note". `settings.test.ts`: no row reads as no
  limit with Manager and Admin; saves and reads back €40.00 and Supervisor, Manager; refuses an empty
  list (`RangeError`, the caller's bug, as today's `settings.ts:26-27` does for the old limit).
  `routes.test.ts`: the reasons and settings routes in the new shape; `400 management.request_invalid`
  for `applyRoles: []`, `["staff","staff"]`, `["chef"]`, and `billApproverRoles: []`; `409
  adjustment_reason.void_required` from `DELETE` of the last Void reason with its `withNote`;
  a manager session served and a session without `adjustment.manage` refused (the existing gate,
  `routes.ts:191-192`, re-pinned for the new shape).
- [ ] **Step 2: FAIL** — `pnpm --filter @waitron/adjustments exec vitest run src/operations.test.ts src/settings.test.ts src/routes.test.ts --project node`.
- [ ] **Step 3: Implement**; `test/seed.ts`'s `seedReason` (Task 1's Comp reason, no item limit)
  goes back through `createAdjustmentReason`, and a `seedVoidReason` sits beside it for callers
  that cancel.
- [ ] **Step 4: PASS**, then the error-code guards.
- [ ] **Step 5: Commit** — `"Reasons and the bill limit are saved in the new shape, keeping a Void reason (A758)"`.

**Changed test checks:** cases in `operations.test.ts`, `settings.test.ts` and `routes.test.ts` that
send or read `applyRole`, `approverRole` or `maxBillDiscountBp` (`git grep -c` on 2026-10-19:
operations 6+6, routes 4+5+12, settings 10) — each listed by name; the approver-below-applier case
(D1: lists, not a ladder). **Fixtures grown:** `test/seed.ts` (kind, lists; `seedVoidReason`).

## Task 5: a new venue's nine reasons, the import's refusal, the demo seed

**Files:** `packages/adjustments/src/provisioning.ts`, `provisioning.test.ts`,
`configuration-transfer.ts`, `configuration-transfer.test.ts`,
`apps/server/scripts/demo-seed/seed-adjustments.ts`, `seed-adjustments.test.ts`,
`apps/server/src/configuration-transfer.test.ts`.

**Starter list (design §4), in this order, positions 0–8**, each with `names: { en, es }` and `name`
in the venue's first invoice language as today (`provisioning.ts:16-22`):

| kind | en / es | actions | applyRoles | approverRoles | maxPercentBp | note |
|---|---|---|---|---|---|---|
| void | Entry error / Error al marcar | cancel | — | — | — | no |
| void | Item not available / Producto agotado | cancel | — | — | — | no |
| void | Customer changed mind / Cambio del cliente | cancel | — | — | — | no |
| void | Not served / No servido | cancel | — | — | — | no |
| void | Other / Otro motivo | cancel | — | — | — | **yes** |
| comp | Complaint / Queja del cliente | comp, %, € | supervisor, manager, admin | supervisor, manager, admin | — | no |
| comp | On the house / Invitación | comp, %, € | manager, admin | manager, admin | — | no |
| comp | Staff meal / Comida de personal | %, € | staff, supervisor, manager, admin | manager, admin | 5000 | no |
| comp | Discount / Descuento | comp, %, € | manager, admin | manager, admin | — | no |

No euro limit and no settings row are seeded (D2, design §4). The seed's summary becomes "Create
the starter void and comp reasons". `ADJUSTMENTS_CONFIGURATION_TRANSFER` gains `validate`:
`setup.request_invalid { field: "adjustment_reasons" }` when the bundle's `adjustment_reasons` is
missing, holds no switched-on Void reason, or none that asks for a note (D27). Read `kind`, `active`
and `note_required` as the export writes them: build the test bundle with
`buildConfigurationBundle`, as `apps/server/src/configuration-transfer.test.ts:1871-1878` does, and
assert the encoding the bundle carries before relying on it. Demo seed
(`seed-adjustments.ts:25-135`): its three cancel reasons become Void; its four comp/discount reasons
become Comp by the fixture rule with their limits, except that its Complaint (`comp` under a 50%
item limit, `:73-74`) loses the item limit (fixture rule); append Not served and Other (note
required) after the Void reasons; nine reasons. The demo names every reason in five languages (`en`,
`es`, `ca`, `ca-ES-valencia`, `gl`; `:27-33` for Entry error) and `scripts/demo-seed/data-set.test.ts:56-57`
collects each reason's names for its translation checks, so the two new reasons carry all five
(Catalan and Galician are ours, listed for the owner beside Open point 4); run that test too.

- [ ] **Step 1: Failing tests.** `provisioning.test.ts`: "gives a new venue the nine starter
  reasons, in order, named in the venue's language" (`toEqual` on `[kind, names.en, applyRoles,
  approverRoles, maxPercentBp, noteRequired]` per row); the English-venue and second-run cases kept.
  `configuration-transfer.test.ts` (package): the validator refuses no Void, a Void only switched
  off, no note-asking Void, and a missing table, and passes the starter list. Server
  `configuration-transfer.test.ts`: a bundle exported from a venue whose only note-asking Void
  reason was switched off is refused at import with `setup.request_invalid` /
  `adjustment_reasons`, and a starter venue's bundle imports. `seed-adjustments.test.ts`: nine
  reasons, one kind each, every Comp reason with both lists, Not served and Other present, Other's
  note required.
- [ ] **Step 2: FAIL** — `pnpm --filter @waitron/adjustments exec vitest run src/provisioning.test.ts src/configuration-transfer.test.ts --project node`
  and `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed-adjustments.test.ts scripts/demo-seed/data-set.test.ts src/configuration-transfer.test.ts`.
- [ ] **Step 3: Implement.** **Step 4: PASS.**
- [ ] **Step 5: Commit** — `"A new venue starts with nine void and comp reasons; an import must keep a Void reason that asks for a note (A758)"`.

**Changed test checks:** `provisioning.test.ts:36` (one reason → nine, D9/D16), `:59` (its names);
`seed-adjustments.test.ts:55` ("the owner's seven example reasons" → nine with Not served and Other,
design §9), `:97` ("every cancel-only reason free of approval" → Void reasons carry no lists, D13);
server `configuration-transfer.test.ts:1878` if its count changes, and `:2135`, `:2151` (the settings
row in euros and roles, D6).

## Task 6: the dashboard's reason form

**Files:** `packages/adjustments/src/dashboard/client.ts`, `client.test.ts`, `reasons-screen.ts`,
`strings.ts`, `reasons-screen.test.ts`, `.unsaved.test.ts`, `.save-state.test.ts`, `.a11y.test.ts`.

**Interfaces — Consumes:** Task 4's wire shape. `client.ts`'s local copies
(`client.ts:9-32`) take it: `kind`, `applyRoles`, `approverRoles`; `AdjustmentSettings =
{ maxBillComp: string | null; billApproverRoles: PersonRole[] }`.

The form (picture 02), in this order: **Kind** (`wt-segmented-control`, options Void / Comp,
«Cancelar» / «Descuento»); **Name** (required) and the name in each content language, as today
(`reasons-screen.ts:940-972`); then, for a Comp only: **Who can apply it** and **Who can approve it**
(each a `wt-combobox` with `multiple` over the four roles, required; the closed field names the
chosen roles through `countLabel`, which reads the draft because the combobox passes only the count
and calls it only for two or more, `packages/ui/src/components/wt-combobox.ts:405`, `:515`; all four
read "Everyone" / «Todos»); **How it can be taken off** (checkboxes Free (100%) / A percentage / An
amount — «Gratis (100 %)» / «Un porcentaje» / «Un importe»; at least one); **Most off one item**
(placeholder "No limit" / «Sin límite»); **Most off one bill** (`wt-price-input`, placeholder "No
limit"). **Note required** last, for both kinds. Hints, quoted from picture 02: apply — "They use it
straight away, up to its limits." / «Lo usan directamente, hasta sus límites.»; approve — "They
enter their PIN when anyone else asks, or above a limit." / «Introducen su PIN cuando lo pide otra
persona o se pasa un límite.»; item — "Everything this reason took off the item counts." / «Cuenta
todo lo que este motivo ha quitado del artículo.»; bill — "The venue's own amount. Above it, someone
who can approve it is asked." / «Lo fija el local. Por encima, se pide a alguien que pueda
autorizarlo.»; Other's note switch on a Void — "The till asks for the note with “Say why”." / «La
caja pide la nota con «Indica el motivo».». Under a Void reason's fields, one line (design §6: "a
short line"): "Who may cancel is set by the refund permission, not by the reason." / «Quién puede
cancelar lo decide el permiso de devolución, no el motivo.» (Open point 4). Labels in English as
picture 02: "Kind", "Who can apply it", "Who can approve it", "How it can be taken off", "Most off
one item", "Most off one bill", "Note required"; Spanish «Tipo», «Quién puede aplicarlo», «Quién
puede autorizarlo», «Cómo se descuenta», «Máximo por artículo», «Máximo por cuenta», «Pide una
nota».

Behaviour: changing the kind clears the fields the new kind lacks (design §3.1); the form refuses
an empty list ("Choose at least one role." / «Elige al menos un rol.») and Free under an item limit
below 100% ("Free takes 100% off: raise this limit or untick Free." / «Gratis quita el 100 %: sube
este límite o desmarca Gratis.», beside Most off one item). A refusal naming a field shows under it
(`SERVER_FIELDS`, `reasons-screen.ts:63-72`, gains `kind`, `applyRoles`, `approverRoles`);
`adjustment_reason.void_required` shows under Kind, or under Note required when `withNote`, as "A
venue keeps at least one Void reason." / «El local necesita al menos un motivo de cancelación.» and
"A venue keeps at least one Void reason that asks for a note." / «El local necesita al menos un
motivo de cancelación que pida una nota.» The save rule is unchanged (`saveActionState` at
`reasons-screen.ts:645`). The list keeps its layout until A758-2; its policy cell
(`reasons-screen.ts:867-868`) shows the two lists in place of the two roles, and the action names
come from the kind and the offers. The Disable path keeps working (`active` stays) and shows the
void-required refusal.

- [ ] **Step 1: Failing tests** in `reasons-screen.test.ts` (browser): "shows only Kind, Name and
  Note required for a Void reason, with the refund-permission line"; "shows both lists, the offers
  and both limits for a Comp reason"; "clears the Comp fields when the kind changes to Void, and
  sends none"; "names the chosen roles in the closed field, and Everyone for all four"; "refuses an
  empty list beside its field and keeps Save disabled"; "refuses Free under a 50% item limit";
  "sends kind, applyRoles and approverRoles" (`toEqual` on the request body); "shows
  void_required under Kind, and under Note required with withNote". `.unsaved.test.ts`: a change of
  each list and of the kind dirties the draft; restoring it cleans it. `.a11y.test.ts`: the Comp form
  and the Void form in both themes.
- [ ] **Step 2: FAIL** — `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen.test.ts src/dashboard/reasons-screen.unsaved.test.ts src/dashboard/reasons-screen.save-state.test.ts src/dashboard/reasons-screen.a11y.test.ts src/dashboard/client.test.ts --project browser`.
- [ ] **Step 3: Implement.** **Step 4: PASS**, then `pnpm --filter @waitron/adjustments exec vitest
  run src/dashboard/strings.test.ts` and `pnpm exec vitest run scripts/native-form-fields.test.ts
  scripts/style-token-names.test.ts`.
- [ ] **Step 5: Commit** — `"The reason form asks for a kind and, for a Comp, two role lists (A758)"`.

**Changed test checks:** `reasons-screen.test.ts:304` ("Give away" — the offers' new names, D10) and
`:372` ("Invitación", same); the role-select cases (`git grep -n "applyRole\|approverRole"` in the
screen tests on 2026-10-19, `applyRole`+`approverRole` lines: `reasons-screen.test.ts` 18+24, `.unsaved` 4+4, `.save-state` 1+1, `.a11y` 3+3, and `client.test.ts` 1+1) — each listed by name (D1).

## Task 7: the dashboard's bill comp limit

**Files:** `reasons-screen.ts` (`#limitSection`, `#limitForm`, `#saveLimit`,
`reasons-screen.ts:660-775`), `strings.ts`, the four screen tests, `client.test.ts`,
`apps/dashboard/src/dashboard-app.test.ts:74`.

Picture 01's section: heading "Limit on a bill's comps" / «Límite de descuentos por cuenta»; "Most
comped on one bill" (`wt-price-input`, placeholder "No limit") / «Máximo descontado en una cuenta»;
"Who can approve past it" (`wt-combobox multiple`, required) / «Quién puede autorizar más»; hint
"Every comp on the bill counts, whatever its reason. Above it, someone on the next list enters their
PIN." / «Cuenta cada descuento de la cuenta, sea cual sea su motivo. Por encima, alguien de la
lista siguiente introduce su PIN.» One Save for both fields, quiet until either changes (today's
`#limitScope`). Today's explanation paragraph (`strings.ts:88-89`) goes.

- [ ] **Step 1: Failing tests:** "saves €40.00 and Manager, Admin together" (`toEqual` on the body
  `{ maxBillComp: "40.00", billApproverRoles: ["manager","admin"] }`); "clears the amount to no
  limit"; "refuses an empty approver list"; "maps a refusal naming billApproverRoles or maxBillComp
  to its field"; the unsaved and save-state cases for both fields.
- [ ] **Step 2: FAIL**, **Step 3: implement**, **Step 4: PASS** (Task 6's command), and
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts --project browser -t "adjustment"`.
- [ ] **Step 5: Commit** — `"The bill's limit is an amount of comps with its own approvers (A758)"`.

**Changed test checks:** the `maxBillDiscountBp` cases (`git grep -c`: reasons-screen 17,
unsaved 13, save-state 4, a11y 1, client 6) and the hint at `reasons-screen.test.ts:1566` (English)
and `:1621` (Spanish) — D6. **Fixtures grown:** `dashboard-app.test.ts:74`'s mocked answer takes the
new shape.

## Task 8: the server judges comps by the lists and asks past a limit

**Before starting:** `gh pr view 1897 --json state`. If `MERGED`, rebase on `main` first and adapt
per "What A773-1 changes".

**Files:** `apps/server/src/adjustments-apply.ts`, `adjustments-api.ts`, `till-api.ts`,
`testing/adjustment-venue.ts`, `testing/cancel-line.ts`, `adjustments-apply.test.ts`,
`adjustments-api.test.ts`, `packages/adjustments/src/record.ts` and `record.test.ts` (`readCompedLines`); `packages/identity/src/staff.ts`, `index.ts`,
new `staff.list-active-with-roles.test.ts`.

**Interfaces — Consumes:** Task 2's `evaluateComp`, `approves`, `Approval`; Task 3's
`readReasonTotals`/`readReasonItemShares`; Task 4's `readAdjustmentSettings`.
**Produces:** `Plan.approval: Approval | null` (in place of `approverRole` and
`overBillDiscountLimit`, `adjustments-apply.ts:182-183`); `AdjustmentPreview.needsApproval:
WireApproval | null` with `WireApproval = { by: "reason"; roles } | { by: "bill_limit"; roles;
limit: string } | { by: "refund" }` (money as `money()` writes it); `approvedBy(tx, approval,
approver, attempts)` refusing `adjustment.approval_required { approval: approval.by }` unless
`approves(approval, role)`; identity `listActivePersonsWithRoles(tx, roles: readonly
PersonRoleValue[]): Promise<StaffListEntry[]>` over `listActivePersonsWhose` (`staff.ts:613`);
`GET /api/adjustment-approvers?roles=manager,admin` (comma-separated, each a role, at least one, no
repeats, else `management.request_invalid` naming `roles`) replacing `?role=`
(`adjustments-api.ts:203-213`); `GET /api/adjustment-reasons` sends `kind`, `actions`,
`noteRequired`, `maxPercentBp`, `maxAmount`, `applyRoles`, `approverRoles` (no `applyRole`,
`approverRole`).

In `planAdjustment` (`adjustments-apply.ts:388-560`), for a comp action: `priorsOf`
(`:566-596`) returns `itemShareBp` per Decision 3; `billComped` is Σ rows `max(0, listValue(row,
row.quantity) − gross(row, row.quantity))` over `readRows`'s rows (Decision 4); settings from
`readAdjustmentSettings`; `evaluateComp`. Delete `shareOf`, `exactly`, `pastBillDiscountLimit`
(`:607-672`) and the role raise (`:533-542`). `approverToCheck` (`adjustments-api.ts:96-110`) reads
`approval`. `till-api.ts`'s `STATUS` loses `adjustment.over_limit` (`:607`).

**Fixtures** (fixture rule): `testing/adjustment-venue.ts:200-234` — Complaint (supervisor /
manager) becomes a Comp reason with no item limit (it offers Free, fixture rule) and keeps its
€30.00; a new **Staff meal** fixture (A percentage, An amount; 50% an item; apply all four roles,
approve Manager, Admin, as design §4) carries the item-limit cases that used Complaint's 50%;
House (all four actions, staff/staff) splits into "House" (Comp, every role on both lists) and
"House void" (Void, `reasonId.houseVoid`); Mistake becomes Void. `testing/cancel-line.ts:19-36` —
`CANCEL_REASON` becomes a Void reason, `GIVE_AWAY_REASON` a Comp reason (every role, both lists).
This task translates the fixtures and the two suites named in its files; Task 8b translates the
rest.

`readCompedLines` (`packages/adjustments/src/record.ts:146`) loses its one product caller with
`pastBillDiscountLimit` (`git grep -n readCompedLines -- apps packages ':!*.test.ts'` on 2026-10-19
finds only `adjustments-apply.ts:11`, `:602`, `:651`, its definition and the `splits` doc
comment at `schema/adjustments.ts:48`, which drops the name): delete it and its
`record.test.ts` describe (`:337-447`, retired with the share limit, D6). The `comped_extras`
column stays: `adjustments` is append-only and its writer is unchanged.

- [ ] **Step 1: Failing tests.** `adjustments-apply.test.ts`, describe "approval (plan D6)"
  (`:805`) rewritten to the lists: "refuses a staff member's comp under Complaint with no approver,
  naming the reason's list" (`approval_required { approval: "reason" }`); "applies it with a
  manager's PIN, recording who asked and who approved"; "refuses a staff member's PIN as the
  approver"; "lets a manager on Who can approve it but off Who can apply it comp straight through"
  (a Complaint copy with apply Supervisor only). Describe "cumulative limits" (`:1290`): "asks for a
  second 30% on one line under a 50% item limit, and applies it with a manager's PIN" (was a refusal,
  D3); "counts a €12.00 amount off the €12.00 Burger as 100% under a 20% item limit" (design §2.2);
  "asks past the reason's €30 on the bill". Preview: `needsApproval` is `{ by: "reason", roles:
  ["manager","admin"] }`. `adjustments-api.test.ts`: the reasons route's shape (`toEqual`); the
  approvers route by `roles`, refusing `?roles=` empty, `chef`, a repeat, and the old `?role=`
  (`400`); a staff session served and a request with no session refused (the route is
  session-gated only, `:203`, kept). **Who may at the route** (Global constraints): a staff cookie's
  comp under Complaint is `403 adjustment.approval_required { approval: "reason" }`, applied with a
  manager's PIN, and still `403` with a supervisor's PIN (on Who can apply it, not on Who can
  approve it); a supervisor cookie's comp within €30 is `200` with no PIN. One more
  "cumulative limits" case: staff take Staff meal 50% off one of two Burgers on one line, then 50%
  off the other, both straight through (Decision 3's carve rule).
  `staff.list-active-with-roles.test.ts`: lists active people whose role is in the list, by name;
  leaves out a suspended person and a role outside the list.
- [ ] **Step 2: FAIL** — `pnpm --filter @waitron/server exec vitest run src/adjustments-apply.test.ts src/adjustments-api.test.ts`
  and `pnpm --filter @waitron/identity exec vitest run src/staff.list-active-with-roles.test.ts`.
- [ ] **Step 3: Implement**, and translate the fixtures.
- [ ] **Step 4: PASS** for the describes above; the bill-limit describes are Task 9's and may stay
  red. Then the error-code guards, and `pnpm --filter @waitron/server exec vitest run
  src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts` (no till route is added
  or removed, so neither route map changes; both must stay green).
- [ ] **Step 5: Commit** — `"The server asks the reason's approvers by list, past any limit (A758)"`.

## Task 8b: the other server suites take the new reasons

**Files:** the server suites that create a reason or use the adjustment venue's: `git grep -l
"createAdjustmentReason\|applyRole\|approverRole"` and `git grep -l "adjustment-venue"` over
`apps/server/src/*.test.ts` on 2026-10-19 name, besides Task 8's `adjustments-apply.test.ts` and
`adjustments-api.test.ts` and Task 5's `configuration-transfer.test.ts`, `made-here.routes.test.ts`, `former-numbers.test.ts`,
`receipt-language.test.ts`, `split-off-extras.split.test.ts`, `business-day-history.test.ts`,
`adjustments-bill-payments.test.ts`, `default-cancel-reason.test.ts`, `adjustments-extra-cancel.test.ts`,
`adjustments-report.test.ts`, `attendance-adjustments.test.ts`, `invoice-document.test.ts` and
`receipt-adjustments.test.ts`.

- [ ] **Step 1:** translate each by the fixture rule; a case that cancels under `reasonId.house`
  takes `reasonId.houseVoid`. Run each file; a case still red for a reason other than its fixture
  is a stop and a report.
- [ ] **Step 2:** `pnpm --filter @waitron/server exec vitest run scripts/demo-seed` and the listed
  files: PASS. Commit — `"Server suites use Void and Comp reasons (A758)"`.

**Changed test checks:** `default-cancel-reason.test.ts:24` ("offers one cancel reason, and a staff
member cancels a dish with it without a PIN": its `toEqual` on the reasons list becomes the nine
starter reasons in the new wire shape, D9, D16 and D1; the cancel without a PIN stays, because
`tabWith` (`testing/bill-venue.ts:309-321`) opens its lines through `openPartyTab`
(`testing/serve-line.ts:23`) and `openTab` (`working-order.ts:1384`), and leaves them unfired (run
2026-10-19: a scratch case found no ticket item for `tabWith`'s two lines, and two fired ones once
`fireAll` ran), so the dish is `unsent`, which Decision 2 lets anyone cancel; if the run shows
otherwise, stop and report). Every other change is a fixture,
listed under "Fixtures grown".

**Changed test checks:** every `needsApproval` assertion (`git grep -c`: apply 26, api 3) — role →
`{ by, roles }` (D1); the `approval_required` assertions (apply 17, api 1) — params (D1); the
cumulative-limit refusals (D3); the olives approval case (`:2399`). **Fixtures grown/reshaped:**
`adjustment-venue.ts` (Complaint without an item limit, Staff meal added, House split), `cancel-line.ts`. **Retired:** the `readCompedLines` describe in `record.test.ts` (D6).

## Task 9: the server's bill comp limit

**Files:** `apps/server/src/adjustments-apply.test.ts` (describes "the venue's limit on a bill's total
discount (B11b)", `:1361-2085`, and the counter one at `:3377`), `adjustments-apply.ts` only if a
case finds a defect.

The share limit's cases test what D6 retires (a share of the bill, exact-versus-shown cents, weighed
rounding of a share). Replace both describes with "the bill's comp limit (A758 §3.5)", each case
on the adjustment venue with `saveAdjustmentSettings({ maxBillComp, billApproverRoles })`:
"reaching €40.00 exactly goes through; one cent past asks the bill's approvers"; "a free item counts
toward it" (was "leaves a comp out of the total", D5); "a comp on the whole bill counts"; "a
cancelled item's comp leaves the count"; "a cancel never asks for the bill's approvers" (voids do not
count); "someone on Who can approve past it goes past alone, whoever the reason's lists name";
"past both the reason's limit and the bill's, one PIN from the bill's list is enough" (design §3.2
step 3); "a PIN from someone off the bill's list is refused"; "a comp on a bill moved from another
bill counts on the bill it is on"; "no limit asks nobody"; the counter describe's one case, at a
counter order.

- [ ] **Step 1: Write the new cases**, removing the old describes. **Step 2: FAIL**
  (`pnpm --filter @waitron/server exec vitest run src/adjustments-apply.test.ts -t "comp limit"`).
- [ ] **Step 3: Fix only what a case proves wrong.** **Step 4: PASS** (the whole file).
- [ ] **Step 5: Commit** — `"Pin the bill's comp limit in euros (A758)"`.

**Changed test checks:** every case of the two B11b describes, retired with the share limit (D6),
listed by name in the PR (`grep -n "it(" … | sed -n` over `:1361-2085` and `:3377-3420` on
2026-10-19 lists them), among them `:1631` and `:1782` (a cancel past the share asks a manager,
design §9.1).

## Task 10: cancels are judged by the refund permission

**Files:** `adjustments-apply.ts`, `adjustments-apply.test.ts`, `adjustments-api.test.ts`,
`testing/cancel-line.ts`, and the server tests the sweep turns red.

For a cancel, `planAdjustment` calls `evaluateCancel` with the dish's stage (`stageOf(dishOf(line,
rows))`, `:280-284`, `:562`) and the actor's role; the plan's `approval` is its verdict. The till
route's PIN check-ahead already reads the plan.

- [ ] **Step 1: Failing tests** in `adjustments-apply.test.ts` describe "a cancel's approval
  (A758 D12, D13)": "staff cancel an unsent dish with nobody's PIN" and "a held one" (Review focus 1);
  "staff are refused a fired dish without a PIN, naming refunds" (`approval_required { approval:
  "refund" }`); "staff cancel a fired dish with a supervisor's PIN, recorded as approved by them";
  "a staff PIN is refused as the approver"; "a supervisor cancels a served dish alone"; "a Comp reason
  cannot cancel" (`action_not_allowed`). Route level in `adjustments-api.test.ts`: the staff
  cookie's fired-dish cancel is `403 adjustment.approval_required` and is applied with a manager's
  PIN; the preview's `needsApproval` is `{ by: "refund" }`.
- [ ] **Step 2: FAIL.** **Step 3: Implement.** **Step 4: PASS.**
- [ ] **Step 5: The helper keeps its promise.** `cancel-line.ts`'s `ensureOperator` (`:51-59`)
  inserts its operator with no role, so at the column's default, `staff`
  (`packages/identity/src/schema/persons.ts:65`; "added (at the default role)", `cancel-line.ts:51`),
  which does not hold the refund permission. The helper's promise is "applied by anyone with no
  approval" (`:17`), so `ensureOperator` now inserts `role: "supervisor"` when it creates the person
  (fixture grown). A caller that passes an existing staff `operatorId`, and every `cancelBody`
  caller (it goes through the route with the test's own session), is not covered by that and is
  Task 10b's.
- [ ] **Step 6: Commit** — `"A cancel off an unpaid bill needs the refund permission once the dish has gone to its station (A758)"`.

## Task 10b: the server suites that cancel

**Files:** the server tests the sweep turns red. `git grep -l "action: \"cancel\"\|cancelLine\b\|cancelBody(" --
'apps/server/src/*.test.ts'` named 30 files on 2026-10-19 (the grep without `cancelBody(` misses seven, among them `unpaid-departure.test.ts` and `till-api.tables.test.ts`), with 64 `cancelLine(` and 22
`cancelBody(` calls among them, so this is a task of its own; if it passes about 100 tool calls,
hand over by the rule above.

- [ ] **Step 1: Sweep.** Run those files. For each newly red case: if the case is about who may
  cancel, assert the new rule (a changed check, D13); otherwise give its actor a role with the
  refund permission, or its session a supervisor's cookie (fixture grown). Both listed, by file and
  case name.
- [ ] **Step 2:** the files PASS; commit — `"Server suites cancel as someone who may (A758)"`.

**Changed test checks:** the cases that assert a cancel's approval by the reason's roles (found by the
sweep, among the 28 `action: "cancel"` lines in `adjustments-apply.test.ts` and 8 in
`adjustments-api.test.ts` counted on 2026-10-19), `adjustments-apply.test.ts:3354` ("asks for the
reason's approver" on a counter cancel) — D13.

## Task 11: the till names who must approve

**Files:** `apps/till/src/api/client.ts`, `client.test.ts`, `till-app.ts`,
`widgets/adjustment-dialog.ts`, `widgets/test-helpers.ts`, `i18n/strings.ts`, `i18n/codes.ts`,
`codes.test.ts`, `till-app-adjustments.test.ts`, `till-app-counter-adjustments.test.ts`,
`widgets/adjustment-dialog.test.ts`, `.a11y.test.ts`, `.unsaved.test.ts`,
`screens/till-table-order-screen.a11y.test.ts`; `till-app-bill-payments.test.ts` is run only as a
regression check: its 11 `needsApproval` lines are a local helper for a refund refused `authorization.not_permitted` (e.g. `:3445`, `:3564`), not an `AdjustmentPreview`.

**Interfaces — Consumes:** Task 8's wire. **Produces:** client `AdjustmentReason` with `kind`,
`applyRoles`, `approverRoles` (no single roles, `client.ts:764-775`); `AdjustmentPreview.needsApproval:
WireApproval | null`, `overBillDiscountLimit` gone (`:807-813`);
`listAdjustmentApprovers(roles: PersonRole[])` → `?roles=` (`:3987`). `#onAdjustConfirm`
(`till-app.ts:10281-10300`) fetches `listAdjustmentApprovers(roles)` for `reason`/`bill_limit` and
`listRefundAuthorizers()` for `refund`, and passes `approverRole: null` to the PIN prompt
(`:8312`), so it shows the `override.*` words. The dialog's approval line
(`adjustment-dialog.ts:758-765`) shows Decision 10's sentence for the approval's `by`, the reason's
name and the limit (`this.#money`). Strings: add `adjust.approval_reason`,
`adjust.approval_bill_limit`, `adjust.approval_refund` (EN/ES, Decision 10); retire
`adjust.approval_staff|supervisor|manager|admin` and `adjust.over_bill_limit` (EN `:1042-1047`, ES
`:2591-2596`) and the `APPROVAL` map (`adjustment-dialog.ts:100`); reword `override.title`,
`override.pick_supervisor`, `override.enter_pin`, `override.no_supervisors` in English. Codes: retire
`adjustment.over_limit` (`codes.ts:580`) and its `refusalField` case (`adjustment-dialog.ts:74`);
`adjustment.approval_required` reads "Someone who can approve this must enter their PIN" / «Alguien
que pueda autorizarlo debe introducir su PIN» (`codes.ts:596-599`).

- [ ] **Step 1: Failing tests:** `adjustment-dialog.test.ts`: "names the reason's approvers for a
  comp: Someone who can approve Complaint must enter their PIN."; "names the bill's limit past it";
  "names refunds for a cancel"; the confirm button still reads "Ask for approval" when approval is
  needed (picture 04). `till-app-adjustments.test.ts`: "asks the server for the reason's list, by its
  roles" (the request path `?roles=manager,admin`); "asks for the refund authorizers for a cancel";
  "applies with the approver's PIN" kept. `client.test.ts`: the new paths. `codes.test.ts`: the new
  approval text in both languages.
- [ ] **Step 2: FAIL** — `pnpm --filter @waitron/till exec vitest run src/widgets/adjustment-dialog.test.ts src/till-app-adjustments.test.ts src/till-app-counter-adjustments.test.ts src/api/client.test.ts src/i18n/codes.test.ts`.
- [ ] **Step 3: Implement.** **Step 4: PASS**, then the a11y files above and
  `pnpm --filter @waitron/till exec vitest run src/widgets/supervisor-override-dialog.test.ts src/till-app-bill-payments.test.ts`.
- [ ] **Step 5: Commit** — `"The till says whose PIN an adjustment needs (A758)"`.

**Changed test checks:** every `needsApproval: "<role>"` fixture or assertion in the till tests
(`git grep -c` on 2026-10-19: till-app-adjustments 13, adjustment-dialog 7,
a11y 4, counter 3, unsaved 1, client 1, test-helpers 1) — shape (D1); the role-named approval
sentences; `codes.test.ts`'s `approval_required` line (D1); the `override.*` English, read through
`t()` by `supervisor-override-dialog.test.ts:207`, so no assertion text changes there.

## Task 12: docs and backlog

**Files:** `docs/backlog.md`, `docs/backlog/till.md`, `docs/developers/conventions-data.md` only if it
names `maxBillDiscountBp` or a reason's single roles (`git grep -n "maxBillDiscount\|applyRole\|approverRole" -- docs/developers`).

- [ ] Update the A758 entry: the rules have landed (one sentence); what remains is A758-2…5 and the
  out-of-scope slices; link this plan. Update `docs/backlog/till.md` "## A758" the same way. Add an
  entry for each open point this PR leaves open (Open points 1–3). Check the docs paths with
  `pnpm exec prettier --file-info` (CLAUDE.md §2: `docs/` is ignored whole).
- [ ] Commit — `"Backlog: A758's rules landed; the page, report, receipt and till words follow"`.

## Task 13: LOOK

- [ ] Start the dev stack with `wa-wt reset demo waitron-feat-a758-1-reason-rules` (the venue needs
  a reset, Global constraints) then `wa-wt demo waitron-feat-a758-1-reason-rules`. Screenshot, in
  light and dark and at 390 px wide: the reason form for a Comp (Complaint, the approver list open)
  and for a Void (Other), beside picture 02; the bill-limit section beside picture 01's; on the till,
  a staff comp of a €25 item under Complaint (the approval line) and the PIN prompt's title, beside
  pictures 03 and 04. Save them under `docs/backlog/mockups/a758-adjustment-reasons/built/`.
- [ ] Record each difference from the pictures in the PR description; fix what is a defect, list
  what is a judgement call as an owner point.

**PR description** (first line): "Needs a venue reset: adjustment reasons change shape and cannot be
carried." Then: the rules in plain words; the `RESETS` entry and any `CANDIDATES`; Changed test
checks and Fixtures grown, collected from Tasks 1–11, 8b and 10b; Open point 1's interim cost; the A773-1 rebase notes.

---

# A758-2 — the page (outline; re-check before starting)

**Review path:** FULL (a migration; Delete). **Branch** `feat/a758-2-voids-and-comps-page`, after
A758-1 lands. Shares 8 files with A773-1 (listed above).

- **Task 1 — real Delete and `active` dropped.** Schema: drop `active` and the partial index
  `adjustment_reasons_active_name_key` (`schema/reasons.ts:43-45`); a full unique index
  `adjustment_reasons_name_key` on `name`. Generate (one rebuild; no `ADD`). Operations:
  `deleteAdjustmentReason` deletes the row, keeping Task 4's Void guards; `deactivate…`,
  `reactivate…` and the reactivate route (`routes.ts:267-273`) go; `DELETE` deletes;
  `listAdjustmentReasons` loses `includeInactive`; `adjustment.reason_inactive` retires (copies:
  `till-api.ts:609`, till `codes.ts:588`, `till-app.ts:894`, `adjustment-dialog.ts:77`, and on
  A773-1's branch `line-cancel.ts`). Measure with the upgrade walk; **first line:** "Needs a venue
  reset where a switched-off adjustment reason exists: it comes back as a reason, and one sharing a
  name with another stops the upgrade." No custom SQL deletes them (Global constraints). The import's
  validator drops its "switched on" reading. Tests: `migrations.test.ts:101` ("…lets an inactive one
  keep it", retired, design §6), the operations/routes Disable/Enable cases (retired), the
  delete-route refusals and a manager served, a session without `adjustment.manage` refused.
- **Task 2 — the page under Service.** `ADJUSTMENTS_DASHBOARD` (`packages/adjustments/src/dashboard/index.ts:24-39`)
  drops `settingsPanels` and adds a `moreScreens` entry `{ id: "adjustment-reasons", navLabelKey:
  "nav.adjustment_reasons", group: "service", requiresPermission: "adjustment.manage" }` ("Voids and
  comps" / «Cancelaciones y descuentos»). Remove the Venue settings tab
  (`apps/dashboard/src/screens/venue-settings-screen.ts:14`, `:22`; strings `:940`, `:3925`).
  CLAUDE.md §3: a module never names its address words in `navigation.ts`. Changed checks:
  `apps/dashboard/src/dashboard-app.test.ts:1822-1863` (the retired address and the panel's place),
  `dashboard-app.settings-panels.test.ts:13-64`, `:154`, `dashboard-app.search-modules.test.ts:451-454`,
  `venue-settings-screen.test.ts:84`, `:196`, `packages/adjustments/src/dashboard/index.test.ts:32-33`
  — design §6 moves the page.
- **Task 3 — the list of picture 01.** Search (`wt-data-table` `searchable`), drag handles with
  `ReorderController` following `apps/dashboard/src/widgets/course-list.ts:1`, `:143` (the reorder
  route stays), columns Name (with a "Note required" lozenge), Kind (a lozenge: Void / Comp), Who can
  apply it, Who can approve it, Limits ("50% an item", "€30.00 a bill"; a Void's cells "—"), a row
  menu keyed `actions` and `pinned: "end"` (CLAUDE.md §3) with Edit and Delete; Move up/down,
  the Status column, its filter and Enable go (`reasons-screen.ts:797-885`). The note under the list,
  quoted from picture 01, shortened: "Drag ⋮⋮ to set the order the till lists them in." The heading
  "Voids and comps" and "The reasons staff choose when they void or comp an item." (picture 01).
  Delete through `wt-delete-dialog` (design-system.md table row at `:725`), refusing with Task 1's
  code. `design-system.md` "Switching off versus deleting" (`:4713-4715`) stops listing adjustment
  reasons. Tests: search, drag (pointer and keyboard), delete and its refusal, `*.unsaved.test.ts`
  for the dialogs, a11y in both themes; `reasons-screen.test.ts` Status/Disable cases retired.
- **Task 4 — docs and backlog; Task 5 — LOOK** (picture 01 in both themes and at 390 px).

# A758-3 — the report (outline; re-check before starting)

**Review path:** LIGHT (reads only; no who-may change). **Branch**
`feat/a758-3-voids-and-comps-report`. Shares no file with A773-1. Touches only
`packages/adjustments/src/{reports.ts, routes.ts, dashboard/adjustment-report-screen.ts,
dashboard/client.ts, dashboard/strings.ts}` and their tests.

- **Task 1 — By kind and each entry's words.** The server keeps `byAction` (so
  `apps/server/src/adjustments-report.test.ts:248-309` and `adjustments-apply.test.ts:2726-2731`,
  both A773-1 files, need no change); the screen draws two rows, Voids («Cancelaciones») = `cancel`
  and Comps («Descuentos») = the three comp actions, replacing `ACTIONS`
  (`adjustment-report-screen.ts:31-36`). Each entry's action cell: "Void" («Cancelado»), "Comp 100%"
  for a free item or an amount that took the item's whole list price (`afterAmount` 0 and
  `beforeAmount` = `nominalValue`, Open point 3), "Comp 20%" for a percentage, "Comp €3.00" for any
  other amount («Descuento 100 %», «Descuento 20 %», «Descuento 3,00 €»). Changed checks:
  `adjustment-report-screen.test.ts:235`, `:260`, `:278` ("Give-aways"), `:536` ("Give away") — D10.
- **Task 2 — By reason's Asked by and Approved by** (§3.7): `ReasonTally` gains `askedBy` and
  `approvedBy` lists of `PersonRef & { count }` (`reports.ts:45-49`); the screen draws them as the
  people table's Approved by does (`adjustment-report-screen.ts:563-572`).
- **Task 3 — the entries' Reason filter:** `GET /management-api/adjustments/report/entries?reasonId=`
  (`routes.ts:205-222`, a UUID or `management.request_invalid`), `listAdjustmentEntries` filters by
  it, and the entries list gains a "Reason" `wt-combobox` with "All reasons" over the report's
  reasons. Test: "Staff meal lists every staff meal with who gave it and who approved it" (§3.7).
- **Task 4 — docs; Task 5 — LOOK.**
- **Not here:** "Void, charged", "Refunded …", «En preparación» and the double count of a €0.00
  cancel in a person's sales (`reports.ts:383`, design §3.8) — the §3.8 slice (Open point 5).

# A758-4 — a full comp prints "Descuento 100%" (outline; re-check before starting)

**Review path:** FULL (a receipt is a fiscal document's companion; the filed record is re-measured).
**Branch** `feat/a758-4-full-comp-receipt`. Shares 9 files with A773-1 (above); start it after
A773-1 lands if that is near, else rebase.

- **Task 1 — the receipt words.** `BillAdjustment` (`packages/adjustments/src/record.ts:176-184`)
  gains `full: boolean` (action `comp`, or `afterAmount` 0 with `beforeAmount` = `nominalValue`);
  `receiptLines` (`apps/server/src/receipt-adjustments.ts:93-97`) sends a full one as
  `{ kind: "discount", percentBp: 10000, amount }`, so `adjustmentLabel`
  (`receipt-document.ts:95-108`) and the till's copy (`apps/till/src/screens/till-ticket-view.ts:114-127`)
  print "Descuento 100%" through the percentage path, in every language's own discount word
  ("Descompte 100%", "Desconto 100%", "Deskontua 100%"). The full invoice's discount rows
  (`receipt-document.ts:290-294`) print the same for `discount.comp`. Retire the `comp` label:
  `packages/country/src/country.ts:74`, `packages/country-es/src/receipt-labels.ts:25`, `:65`, `:105`,
  `:145`, and any fallback in `packages/country-packs/src/registry.ts:142`.
- **Task 2 — the filed record is untouched, measured:** a test issues a sale with a full comp and
  compares its `registros_facturacion` row and alta XML before and after the change (on the base
  commit in a throwaway worktree, CLAUDE.md §4) — equal. The golden tests run unedited.
- **Changed test checks (design §9.1, re-grepped 2026-10-19 with `git grep -n -i "invitaci\|Gonbidapena" -- 'apps/**/*.test.ts' 'packages/**/*.test.ts'`):**
  `apps/server/src/receipt-ticket.test.ts:241-245` (the label table), `:2231`, `:2238`, `:2276` and
  `:2287` ("prints the comp's label as Invitación"), `:2319`, `:2467`, `:2503`, `:2539` (Basque);
  `receipt-adjustments.test.ts:592`; `adjustments-apply.test.ts:447` and `:475`;
  `adjustments-bill-payments.test.ts:244`; `receipt-document.test.ts:787`;
  `apps/till/src/screens/till-ticket-view.test.ts:1549-1550`, `:1810` — each to "Descuento 100%" or
  the language's word (D11). Unchanged: the staff-invitation hits (`staff-screen.test.ts:469`, `:811`,
  `staff-list.test.ts:65`, `done-screen.test.ts:133`) and the demo seed's reason name.

# A758-5 — the till's Comp words (outline; starts after A773-1 lands)

**Review path:** LIGHT unless the re-check finds a who-may change. **Branch**
`feat/a758-5-comp-window-words`. Re-plan against `main` once A773-1 has landed: its Comp window
(A773-1 Task 16) already titles "Comp…" / «Descuento…» (`comp.title` on `e118de96e`).

- The table screen's and basket's Comp action: English "Comp" in place of "Give away"
  (`table.comp_line`, `apps/till/src/i18n/strings.ts:1005`), Spanish «Descuento» in place of
  «Invitar» (`:2554`); titles `adjust.comp_title` / `comp_extra_title` (`:1010`, `:1012`, ES `:2559`,
  `:2561`), `comp.make_free` («Invitar {n}» on A773-1's branch); `codes.ts:586`'s «no se puede invitar
  ni descontar» → «no se puede descontar».
- "Comp the bill" with Free (100%) as a third choice beside % and € (a 100% percentage, design §3.4;
  bill rows already allow it, `schema/adjustments.ts:97-101`).
- The Comp window keeps "Ask for approval" (design §3.2).
- **Changed test checks (design §9.1):** `till-table-order-screen.adjustments.test.ts:167`, its
  `.a11y.test.ts`, `widgets/adjustment-dialog.test.ts:205`, `:216-224`, `basket.adjustments.test.ts`,
  `till-app-adjustments.test.ts`, `till-app-counter-adjustments.test.ts`, `codes.test.ts:388`; test
  names only at `basket.a11y.test.ts:61`.
- **Last PR:** delete the A758 backlog entry; leave the §3.8 slice, "They'll collect it at the
  counter" (A908 exists) and each open point still open as their own short entries.

---

## Open points (each with the default this plan uses)

1. **A fired dish on `main` before A773-1** needs the refund permission to cancel, though it may not
   have been started: `main` cannot ask "Has preparation started?" (D12). Default: ask for the PIN
   (stricter). A773-1's dialog removes the gap. **What it costs until then:** today a new venue's
   Entry error lets staff cancel any dish alone (`provisioning.ts:24`, `:27`); under this default a
   staff member needs a supervisor's, manager's or admin's PIN for every fired or served dish, so a shift with
   only staff cannot take a wrongly fired dish off at all; and main's cancel is the adjustment
   window, which shows "Ask for approval" where D14 wants the action's name (A773-1 replaces that
   window). The PR description says both. **Why not the station's mark:** main does know when a
   station has marked a dish started (`ticketState` preparing or ready, `adjustments-apply.ts:145`,
   the same test lane G's "started" uses, `line-cancel-context.ts` on `e118de96e`), so "PIN only
   once marked started or served" is the lenient alternative. It is not the default because it
   would be wrong the day A773-1 lands unless the server also reads A773-1's `preparationStarted`
   (a "Yes" for a fired dish the station has not marked would otherwise pass with no PIN, against
   D13), while the stage rule is right on both sides with no adaptation. Pre-live, no venue is
   affected. The driver may choose the alternative if A773-1 is not near landing.
2. **The item limit errs toward asking** in two ways: each row's share is rounded up to a whole
   basis point, and a comp on the whole bill counts against items added after it. Default: accept
   (never lets through what should ask); a backlog entry if a venue meets it.
3. **"Full" for an amount comp** means it took the item's whole list price (`afterAmount` 0 and
   `beforeAmount` = `nominalValue`). An amount that takes what another comp left prints "Descuento"
   with its amount, not "Descuento 100%". Default: as stated; the owner may say otherwise.
4. **Words not drawn by the owner's pictures:** the Void form's one line, "Who may cancel is set by
   the refund permission, not by the reason." (picture 02 draws a longer box; design §6 asks for "a
   short line"); every Spanish word of the form, the bill-limit section, the till's three approval
   sentences and the void-required messages; the kinds as «Cancelar» / «Descuento» (D10's verbs, used
   as the kind's name). Default: as written in Tasks 6, 7 and 11; listed in the PR for the owner.
5. **A773-1's €0.00 "still charge" cancel rows** are added to a person's sales as if the dish had
   left the bill (`reports.ts:383`, design §3.8). Nothing stored says which cancels kept the charge.
   Default: the §3.8 slice, whose migration adds the per-cancel flag, fixes it; until then the report
   over-counts that person's sales by the dish's value.
6. **Venue resets:** A758-1 always (reasons cannot be carried); A758-2 where a switched-off reason
   exists. Default: say so in each PR's first line; no custom migration SQL.
7. **The policy snapshot does not record the venue's bill comp limit** that applied. Default: the
   snapshot is the reason's policy, as today; nothing reads it back.
