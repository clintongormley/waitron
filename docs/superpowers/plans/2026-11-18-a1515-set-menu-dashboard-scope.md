# A1515 set-menu dashboard pull-request scope

A manager can create a set menu, set its terms, choose dishes, variants, surcharges and courses,
and say what one set menu includes. They can place it in a full menu and publish that menu. The
zone offers read then carries the published copy. The
[implementation plan](2026-11-18-a1515-set-menu-dashboard.md) lists the exact files and tests
for the 19 tasks. Till ordering, the bill and fiscal documents, and demo menus follow separately.

| PR | Tasks and files | Checkpoint and evidence | Estimated added code / test lines |
| --- | --- | --- | --- |
| 1 | 1–2 · DB schema, course deletion, menu operations and periods | Store a priced draft. Test both kinds' term constraints, deletion, ordinary-only period choices, the Madrid baseline and schema guards. The PR opens with **Resets test venues**. | 300–450 / 600–900, plus 350–450 generated baseline lines |
| 2 | 3a–3c · shared member types and menu, media and app tree readers | Hold a set-menu member without combining prices. Check graph, document and device-home readers and ordinary prices. Keep the three tasks together. | 350–550 / 700–1,100 |
| 3 | 4, 4b, 4c · menu writes, copies and offer sync | Manage dishes, variants, courses and lines. Database tests own eligibility, amounts, copying and the change stamp. The editor read names the menus holding the draft. | 560–760 / 1,120–1,520 |
| 4 | 5a–5c · menu documents, publication and dashboard Preview | Publish or queue a copy with the full menu. Check refusals, draft edits, live corrections, and the new Preview change kind and source with their words and link. | 520–730 / 1,040–1,460 |
| 5 | 6a–6b · zone offers and shared wire types | Serve copies and read a recorded version. Zone tests own stable keys, availability, course overlays and newest-copy choice. | 300–450 / 600–900 |
| 6 | 7 · management routes and dashboard client | Exercise the existing management access checks, the new routes, member add and replace, and Home shortcut refusals. | 260–400 / 520–800 |
| 7 | 8a–8b and 10 · Menus screen, terms and inclusion lines | Verify the editor with a fixture draft. Browser tests cover terms, the class-change refusal, leaving with unsaved edits, problems and accessibility. The problems list can link to the product. | 500–700 / 1,000–1,400 |
| 8 | 9 · dish, variant and copy controls | Complete the fixture draft. Reuse the product picker and inline prices. Browser tests cover each save and the visible changes to lines. Add and test the Variants control in the problems list. | 500–700 / 1,000–1,400 |
| 9 | 11 plus Add menu and Help from 8a–8b · Menus screen, structure table and both guides | Open the whole flow to managers. Create, place and publish a set menu on the dev stack and check the zone read. A surcharge edit reaches it after republishing. | 380–580 / 760–1,160 |

Reuse the menu root, offers, variant overrides and publication path. Follow the plan's named
defaults for open owner questions. Keep the new setup flow behind existing management access.
Add the dashboard's Set menu creation choice and its Help link once the editor and placement are
ready. Update A1515's backlog entry then. Each checkpoint has a three-hour target to open.

The watcher cleared Tasks 1–2 on 18 November at 13:17 and kept Task 6b in Lane D. The ordering
plan's Tasks 1 and 6 and the demo plan already consume that contract. Test estimates use the
watcher's comparison of 37 merged changes, about two test lines per code line. If a checkpoint
needs splitting, split PR 3 at Task 4 / 4b–4c, PR 4 at 5a / 5b–5c, PR 7 at 8a–8b / 10, and PR 8
at Task 9's dishes table / its Variants and Copy dialogs.
