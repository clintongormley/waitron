# A417 — the till's non-save buttons are drawn quiet while they wait

Queue item A417 (lane B, moved from lane A 2026-10-10). Owner ruling (2026-10-08, "b", on A409 #1433):
a button that is not a save is drawn `secondary` while it waits for a choice, a selection or a load,
and its own variant once it can act, keeping its own variant while its own action is being sent
(A416 #1440); a button its row's own state rules out is `secondary` too (A427 #1446). Rule text:
`docs/developers/design-system.md` → Forms ("The owner made this the rule for the dashboard and the
till … the till's two buttons are A417").

Branch `feat/service-till-quiet-buttons`, worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-service-till-quiet-buttons`. Light review
path: no migration, fiscal, auth, permission or shared `wt-*` change.

## Decisions this plan makes that the item does not

1. **Eight buttons, not two.** The queue item named none ("find them"). Two of the eight match the
   pair A409's review subagent flagged (its text survives only in a lane B session transcript of
   2026-10-08, not in #1433). A full survey of `apps/till/src` found six more breaking the same rule.
   The owner's "b" was "draw them all quiet the same way", and A416 likewise took buttons beyond its
   list (the profile window's Edit, the backup key's Change the key). DEFAULT: all eight; the FYI
   names the six extra so the owner can strike any.
2. **Cash and Card on the pay card** are grey while the basket is empty or the counter holds the pay
   controls (`#payHeld()` in `till-app.ts`: a stale or blocked basket line, or an order already part
   paid — the row-state case of A427). They keep blue while a payment is being sent, even if the
   basket becomes held or empty during that send (A416's precedent: Print a copy and Change the key
   keep their colour through their own send). DEFAULT: as stated; which conditions disable them is
   unchanged. The same widget is the table screen's pay card
   (`screens/till-table-order-screen.ts` ~3289, `.busy=${this.busy}`, no `held`): there Cash and
   Card go grey while the bill has no lines.
3. **Split's Add bill** is grey only while no line quantity is chosen; after a press with field
   errors it keeps blue (an action blocked by its own field checks keeps its colour).
4. **Card** stays blue when it is disabled only by an invalid tip after a press (own field checks).
5. **The extras picker's Add when adding a dish** is grey while a required choice is missing
   (`#satisfied` false). In edit mode it is a save and follows the save rule already; unchanged.

## The eight buttons (paths under `apps/till/src`; line numbers on main 7d84ea385)

| # | Button | Where | Disabled today | Grey when |
|---|---|---|---|---|
| 1 | Confirm in the "which station makes this" question after a refused edit (`data-edit-dead-ends-retry`) | `till-app.ts` ~6924 | `pending.stationId === undefined` | the same |
| 2 | Transfer (`data-transfer-confirm`) | `screens/till-table-order-screen.ts` ~4876 | `!canConfirm` | the same |
| 3 | Add bill in Split (`data-split-confirm`) | same file ~4917 | `splitQuantities.size === 0 \|\| errors.length > 0` | `splitQuantities.size === 0` only |
| 4 | Confirm in the send preview (`data-draft-confirm`) | same file ~3242 | `pending?.checking === true \|\| some row has no makeAt` | the same |
| 5 | Continue in the dead-ends dialog (`data-continue`) | `widgets/dead-ends-dialog.ts` ~153 | some row has no choice | the same |
| 6 | Add in the extras picker, adding a dish (`.confirm`) | `widgets/modifier-picker.ts` ~577 | `saveAction.unchanged \|\| !#satisfied(...)` | adding and `!#satisfied(...)` (edit mode keeps `saveAction.variant`) |
| 7 | Cash (`.pay`) | `widgets/tender-pay.ts` ~766 | `lineCount === 0 \|\| busy` | `held \|\| (!busy && lineCount === 0)` |
| 8 | Card (`.pay-card`) | same file ~746 | `disabled \|\| (tipAttempted && tipInvalid)` | `held \|\| (!busy && lineCount === 0)` |

The till's own precedent is an inline ternary (`variant=${expired ? "secondary" : variant}`,
`till-table-order-screen.ts` ~3065; `station-today.ts` ~218). There is no shared helper; do not add
one. **No `disabled` expression changes** — only the `variant`.

For 7 and 8: `widgets/card-grid.ts` ~443 passes `.busy=${this.busy || this.payHeld}` to
`<till-tender-pay>`. Keep that (its handlers refuse on `busy`), and ADD a `held` boolean property on
`till-tender-pay` that card-grid binds to `this.payHeld && !this.busy`, read only to choose the
variant. card-grid's own `busy` means a request is being sent (`submitting || placing` on the
counter, `till-app.ts` ~8735 via `till-counter-screen.ts` ~342; `submitting` on other tabs, ~8769),
so `held` is false through a send. tender-pay's own `busy` doc comment (~196–200) describes the
OR-ed binding; correct it to say `busy` is a send in progress and `held` is the pay controls held. Hold,
Place and the full-invoice button are already `secondary`; leave them.

## Global constraints

- TDD: each button gets a Chromium test (the till's suites run in real headless Chromium) that
  asserts the `variant` attribute in the waiting state AND in the can-act state, and — where the
  button has a sending state (7, 8) — that it keeps `primary` while sending. Say what the failing
  case prints before running it. Prove each by deletion (revert the ternary, watch it fail).
- Rows 1–6 have no sending state of their own (they close or dispatch at once); assert waiting →
  `secondary`, can-act → `primary`.
- No existing assertion changes. If one must, it is listed under "Changed test checks" in the PR
  with why (owner's 2026-10-05 test-change decision).
- Focused runs only: `pnpm --filter @waitron/till exec vitest run <file>`. Read the `Tests` count.
- `pnpm format:check`, `pnpm lint` (scoped is fine) and `pnpm --filter @waitron/till typecheck`
  before each commit. Every commit `git commit -s`.

## Tasks

### Task 1 — rows 1–6 (table screen, till-app, dead-ends dialog, extras picker)

Tests in the files that already mount each: `till-app-drafts.test.ts` (1),
`screens/till-table-order-screen.test.ts` (2, 3), `screens/till-table-order-screen.dead-ends.test.ts`
(4), `widgets/dead-ends-dialog.test.ts` (5), `widgets/modifier-picker.save-state.test.ts` (6, plus a
control: edit mode still follows `saveAction.variant`). Controls: row 3, a press with a bad quantity
leaves Add bill disabled AND `primary`; row 4, both waits — the station check held open
(`checking`) and a row with no station chosen. One painted-fill check per file (the button's
computed background against a `secondary` sibling such as Cancel or Back, light and dark), as A416
did.

### Task 2 — rows 7–8 (tender-pay + card-grid)

Tests in `widgets/tender-pay.test.ts` (empty basket → both grey; a line → both blue; `busy` with a
line → both blue; `busy` with the basket emptied → both blue; `held` and `busy` with a line, as
card-grid sends them → both grey; invalid tip after a press → Card blue and disabled),
`widgets/card-grid.test.ts` (new case: `payHeld` with a line → grey Cash/Card; `payHeld` and `busy`
→ blue, the held-mid-send case), and `screens/till-table-order-screen.test.ts` (the table screen's
pay card: empty bill → grey, a line → blue). One painted-fill check against Hold.

### Task 3 — docs and look

- `docs/developers/design-system.md` → Forms: replace "the till's two buttons are A417" with the
  till buttons now under the rule, in the same style as A416's and A427's lists.
- `docs/backlog.md`: delete the "two till buttons are A417" entry; `docs/backlog/dashboard.md`'s
  "The two till buttons are A417 (lane A)." becomes "**Landed as #<PR>.**" wording at land time.
- PR "Not changed": the supervisor override's Authorise and the lock screen (sign-in), buttons
  blocked by their own field errors, buttons disabled only while sending, and keep-open's Save (a
  save; it stays blue while its chosen time is no longer offered — an FYI for the owner, not changed).
- LOOK: each changed button (the table screen's pay card too) in EN and ES, light and dark, at the till's width (1024) and phone (390),
  waiting and can-act. Shots in `~/waitron-campaign-b/a417-shots/`.
