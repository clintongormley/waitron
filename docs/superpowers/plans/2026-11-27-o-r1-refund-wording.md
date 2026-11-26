# R1: "Refund" in every till string (lane O, TILL-REDESIGN-PAY-3)

What staff get: wherever the till says "Give money back", "Give back" or "Money back", it says
"Refund" instead, in English, in the till's help bubbles and in the staff guide. Spanish keeps
"devolver" and "devolución", which already are the Spanish refund words; only the action's name
"Devolver dinero" becomes "Devolver". Nothing the till does changes.

Sources: spec §7.12 ("Refund" everywhere, owner 2026-11-26: "refund everywhere, i don't like 'give
money back'") and §13's build note ("the `give_back.*` and `bill_refund.*` keys' English and
Spanish"); the watcher's clearance of the cuts at 23:08 on 26 November, change 3 (every till
string: `codes.ts` errors, `finish_table.*` and cancel-dish strings, `help-strings.ts`, "Money back
under way"; change the text, keep the key names; give the real size). Frames: none.

## What changes

1. **`apps/till/src/i18n/strings.ts`, `codes.ts`, `help-strings.ts`, English.** Every string
   naming the action or the money says refund: "Give money back" → "Refund", "Give back {amount}" →
   "Refund {amount}", "Money back under way" → "Refund under way" (Find a bill's group:
   "Refunds under way"), "money back" as a noun → "refund", "give it back" → "refund it". Sentences
   are reread whole, not word-swapped, and stay as short as their meaning allows. Measured with
   `rg -c -i "give (money )?back|money back"`: 41 lines in `strings.ts`, 42 in `codes.ts`, 1 in
   `help-strings.ts`.
2. **Spanish.** "Devolver dinero" (30 lines across the three files) → "Devolver". Every other
   Spanish line already says devolver or devolución and stays.
3. **The staff guide.** `apps/server/src/guide/en/table-service.md` (27 lines) says Refund. Its
   Spanish twin changes only where it names "Devolver dinero". Section ids (`{#…}`) stay, so
   `help-guide.ts` links keep working.
4. **Keys, files, element names and code comments stay** (`give_back.*`, `give-back-dialog.ts`).
   Renaming them would touch every importer for no change staff see.
5. **Telling two refunds apart.** The bill's "Refund a payment" (`bill_refund.*`, before the bill
   closes) already says refund. Where a sentence sends staff to the receipt's action it names the
   place: "choose Refund on the receipt". The cancel-dish window's "Untick Refund" checkbox keeps
   its name; its sentences already say which window.

Out of scope: the dashboard's alert wording, server error and log text, and printed paper. None is
a till string.

## Tests

The wording is the behaviour. `apps/till/src/i18n/refund-wording.test.ts` pins A803's refund
sentences: it gains a case per renamed action string (title, submit, under way, Find a bill's
group, help bubble), checked in both languages, written first and seen failing. Test files that
assert today's English or Spanish literally (about 25 under `apps/till/src`, listed by
`rg -l -i "give (money )?back|money back|devolver dinero" --glob '*.test.ts' apps/till`) take the
new text; their checks stay as strict. No test outside `apps/till` asserts a till string (the
server's matches are comments and test names, checked by reading each). `guide-content.test.ts`
and `scripts/guide-links.test.ts` run unchanged.

## Size and review

About 120 English lines, 30 Spanish lines, 30 guide lines and the test literals: text only, no
code path changes. No risk trigger, so the light path: no per-task reviewer; `/finish-branch` runs
the convention seat and the Codex run-it seat. Pictures: none needed (no layout changes); the
longest new string is shorter than the one it replaces. Lane O lands it.

Overlap: lane L's CORRECT-FULL-INVOICE PR 2b will touch `codes.ts` and `strings.ts`. Its PR 2a
(#4448) is on `main`; whoever lands second rebases and keeps both sides, saying "Refund" in any
new string.

## Question for the watcher

Spanish: keep "devolver"/"devolución" and change only "Devolver dinero" to "Devolver"
(recommended: the till's Spanish already uses them for refunds, `refund_ack.*`,
`find_page.refund`), or use "reembolsar"/"reembolso" throughout?
