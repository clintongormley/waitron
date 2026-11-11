# A1315: zone Reset guide plan

Request, verbatim from `~/waitron-campaign-d/queue.md`, A1315: “Remaining guide destination: zone Reset, docs/backlog/dashboard.md#a1315-bring-every-help-bubble-down-to-orientation-one-area-per-pr. Keep A1247's existing menu-wrapper exclusion.”
“Any further area change needs its short source-informed plan, one Claude read and watcher PLAN FOR APPROVAL. Keep useful facts in linked EN/ES guides; do not document automatic corner cases. Every changed copy is listed before/after in EN/ES with source receipts and any changed test checks.”
Review: one Claude read (197s), `~/waitron-campaign-d/receipts/a1315-zone-plan-review.md`; driver accepts every finding and reduces the copy to the menu step plus physically matching the map. Watcher clearance remains pending. Authority: watcher `questions.md`, 2026-11-10 22:32, cleared guide-only sections while A1247 stands; 23:45 cleared the previous combined menu guide plan. Neither clears this plan. Obtain one Claude read, address findings, then watcher PLAN FOR APPROVAL before building; no owner plan approval is claimed.
Files after clearance: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`, `docs/backlog.md`, `docs/backlog/dashboard.md` only. Add the section immediately after `{#floor-view}` (EN:478–483, ES:506–512), before Equipment, with shared `{#zone-reset}`. Preserve A1247's decision (`docs/backlog/dashboard.md:526–527`); no menu/help wrappers, links, confirmation, code, tests or support changes.

Source readings, not runtime verification: `apps/till/src/widgets/floor-zone-menu.ts:132–180` supplies the named plan action and confirmation; `apps/till/src/screens/till-floor-screen.ts:2243–2248` → `apps/till/src/api/client.ts:4730–4735` → `apps/server/src/floor-today-api.ts:254–273,321–337` resets today's recorded set; `apps/server/src/floor-today-store.ts:143–152,228–271` reads that saved plan. The displayed name comes from `apps/server/src/till-api.ts:2812–2822`.
Waiting and return receipts: `apps/server/src/floor-reset-plan.ts:108–141` holds occupied/uncleared tables; `apps/server/src/floor-today-store.ts:477–492,640–649,812–832` marks later moves. EN labels/body: `apps/till/src/i18n/strings.ts:1071–1075,1088–1094`; ES:3026–3030,3042–3048. Staff action: `apps/till/src/screens/till-floor-screen.ts:155–159,1321–1324,2924–2935` → client:4665–4666 → `apps/server/src/floor-today-api.ts:205–207` → `apps/server/src/floor-today-mark-moved.ts:44–51,119–124`. Omit automatic exceptions, per `docs/developers/conventions-ui.md:115–126`.

EN before: absent. EN after, exact Markdown:
```markdown
## Reset a zone to today's plan {#zone-reset}

To undo today's changes to a zone, open its ⋮ menu, choose **Reset to … plan** for the plan named there, and confirm **Reset**.

After resetting, move the free tables to match the map.
```
ES before: absent. ES after, exact Markdown:
```markdown
## Restablecer una zona al plano de hoy {#zone-reset}

Para deshacer los cambios de hoy en una zona, abre su menú ⋮, elige **Volver al plano …** con el nombre del plano que aparece y confirma **Restablecer**.

Después de restablecer la zona, coloca las mesas libres como aparecen en el mapa.
```
Backlog before → after (English only, no Spanish twins): `docs/backlog.md:1413–1415` reads “**A1315. Help bubbles: missing guide destinations.** Zone Reset still has no guide section.” followed by the conventions rule and detail links; `docs/backlog/dashboard.md:907–914` has the A1315 heading, source-reading/before-and-after rule and “**No guide section to link yet:** the guide has no section on a zone's Reset.” After: delete both complete entries including their separator (index through1416, detail about−10lines), not mark done; retain the separate A1247 decision. Record these deletions and both guide additions before/after in the eventual change description.
After building, run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`; require passing test counts. `guide-content.test.ts:142–173` covers the new section through rendering and twin heading order. `guide-links.test.ts:41–54` checks existing registered destinations and path writers; it does not exercise the unregistered zone-reset section. Neither proves prose accuracy. Changed test checks: none; invent no prose tests.
Inspect rendered `/help/en/table-service#zone-reset` and `/help/es/table-service#zone-reset` in light/dark at 390/1280px (eight views), checking heading navigation, highlighting, wrapping and overflow. Run `git diff --check`; compare both languages with UI labels. Keep visual evidence outside git. These are future build checks, not performed by this plan author.
Estimate added/removed doc lines separately: guides about +16/−0 total with normal wrapping; backlog about +0/−14; this plan +30/−0. Production code +0/−0; tests +0/−0; support +0/−0. This author writes only this plan; Claude review and watcher clearance remain pending.

Dated clearance, 2026-11-11: the watcher cleared this reduced plan at04:35 in `~/waitron-campaign-d/questions.md`: “A1315 zone Reset guide plan (the smaller route): CLEARED: the menu step plus the physical step no screen prompts, with nothing repeated from the confirmation card.” The owner did not approve this plan. The earlier pending-clearance wording records its review stage.
