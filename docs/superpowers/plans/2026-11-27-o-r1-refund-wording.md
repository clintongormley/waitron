# R1: "Refund" in every till string (lane O, TILL-REDESIGN-PAY-3)

What staff get: wherever the till says "Give money back", "Give back", "Money back" or that money
"goes back", it says "Refund" instead, in the till's English, its help bubbles, the staff guide, and
the dashboard sentences that send staff to that till control. Nothing the till does changes.

Sources: spec §7.12 ("Refund" everywhere, owner 2026-11-26: "refund everywhere, i don't like 'give
money back'") and §13's build note ("the `give_back.*` and `bill_refund.*` keys' English and
Spanish"); the watcher's clearance of the cuts at 23:08 on 26 November, change 3 (every till
string: `codes.ts` errors, `finish_table.*` and cancel-dish strings, `help-strings.ts`, "Money back
under way"; change the text, keep the key names; give the real size). Frames: none.

## What changes

1. **The till's English** (`apps/till/src/i18n/strings.ts`, `codes.ts`, `help-strings.ts`). Every
   string naming the action, or money going back to a guest, says refund: "Give money back" →
   "Refund", "Give back {amount}" → "Refund {amount}", "Money back under way" → "Refund under way"
   (Find a bill's group: "Refunds under way"), "{amount} goes back to the card" → "{amount} is
   refunded to the card", "Given back: {amount}" → "Refunded: {amount}", "money back" as a noun →
   "refund". Sentences are reread whole and stay as short as their meaning allows. The list is
   every line matching `give (money )?back|money back|goes? back|given back|gave back|giving.*back|
   (the )?(extra|rest|money|cash) back` in those files, minus lines meaning "go back to a screen"
   (three in `help-strings.ts`, and the kitchen's `station.back_to_preparing`). Measured: 41 + 30
   lines in `strings.ts`, 42 + 23 in `codes.ts`, 1 in `help-strings.ts`, about 140 English lines.
2. **Two refund controls stay distinct.** The receipt's action becomes **Refund**; the per-dish
   checkbox in the cancel-dish and finish-table windows (`find_page.refund`, "Refund") keeps its
   name. Sentences that name both are reworded so they cannot be confused, naming the receipt:
   `codes.ts:1163`, `:1185`, `cancel_item.refund_at_till` and their Spanish ("…untick Refund on one
   of them, then refund it from the receipt"). "Refund {amount}" on a table, a bill's excess and a
   bill's payment already mean the same thing in different windows and stay.
3. **Spanish changes too** (the watcher, 2026-11-27 02:15): the action and window named "Devolver
   dinero" become "Devolución", a noun as "Refund" is; the button keeps the verb "Devolver", and
   text that already says devolución stays. Sentences naming both controls name the receipt.
4. **The staff guide.** `apps/server/src/guide/en/table-service.md` (33 lines on the pattern above)
   says refund. Its heading `## Give money back {#give-money-back}` becomes `## Refund from a
   receipt {#give-money-back}`, distinct from its neighbours "Refund all or part of a payment" and
   "Refund a card payment on a separate terminal". Ids stay, so `help-guide.ts` and
   `give-back-dialog.ts` links keep working. The Spanish guide's heading becomes `## Devolución
   desde un recibo {#give-money-back}`, as item 3.
5. **The dashboard's pointers to the till.** `apps/dashboard/src/i18n/alert-messages.ts` (the
   "Money back under way" pointers, lines 487–503) and the permission descriptions in
   `apps/dashboard/src/i18n/strings.ts:13,15` ("Give money back on the till") name the till's
   control by its new name in both languages.
6. **Keys, files, element names and code comments stay** (`give_back.*`, `give-back-dialog.ts`).
   Renaming them would touch every importer for no change staff see.

Out of scope: server error and log text, printed paper and the accountant export's column headings
(checked: the server's other matches are comments and test names).

## Tests

The wording is the behaviour. `apps/till/src/i18n/refund-wording.test.ts` pins A803's refund
sentences: it gains a case per renamed action string (title, submit, under way, Find a bill's
group, the help bubble, the two-control sentences of item 2), written first and seen failing. The
till test files asserting today's English literally (about 54 on the pattern above) and
`apps/dashboard/src/i18n/alerts.test.ts:1067-1107` take the new text; their checks stay as strict.
`guide-content.test.ts` and `scripts/guide-links.test.ts` pin none of this text and run unchanged.

## Size and review

About 140 English till lines, 33 guide lines, about 6 dashboard lines and the test literals: text
only, no code path. No risk trigger, so the light path: no per-task reviewer; `/finish-branch` runs
the convention seat and the Codex run-it seat. No pictures (no layout change; each new string is no
longer than the one it replaces). Lane O lands it. R3's Refund button opens this renamed window.

Overlap: lane L's CORRECT-FULL-INVOICE PR 2b will touch `codes.ts` and `strings.ts`. Its PR 2a
(#4448) is on `main`; whoever lands second rebases and keeps both sides, saying "Refund" in any new
English string.

Claude read (fresh context, 2026-11-27): it found the first pattern missed about 53 lines, the
dashboard's pointers, the Spanish clash and the two-control sentences; all applied above.

## Question for the watcher

Spanish: leave it unchanged (recommended, item 3), or change it too, and if so to what?

Answered: the watcher, 2026-11-27 02:15: Spanish changes too, as item 3.
