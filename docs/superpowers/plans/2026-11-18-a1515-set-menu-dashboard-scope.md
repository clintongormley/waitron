# A1515 set-menu dashboard pull-request scope

A manager can create a set menu, set its price and VAT class, choose dishes, variants, surcharges
and courses, and say what one set menu includes. They can place it in a full menu and publish that
menu. The zone offers read then carries the published copy. The
[implementation plan](2026-11-18-a1515-set-menu-dashboard.md) has 19 tasks and lists their exact
files and tests. Till ordering, the bill and fiscal documents, and the new demo menus are later
pieces.

| PR | Tasks and files | What works at this checkpoint and how to check it | Estimated added code / test lines |
| --- | --- | --- | --- |
| 1 | 1–2 · DB schema, course deletion, shared and menu types, and menu periods | Storage and menu operations can create a priced draft. Test constraints, course deletion, periods, the Madrid baseline and schema guards. | 300–450 / 180–280, plus the regenerated baseline |
| 2 | 3a–3c · shared member types and menu, media and app tree readers | A full menu can hold a set-menu member in the domain layer. Check graph and document readers and pin ordinary prices and device-home behaviour. Keep the three tasks together across the shared type change. | 350–550 / 180–280 |
| 3 | 4, 4b, 4c · menu writes, copies and offer sync | The menu package can manage dishes, variants, courses and inclusion lines. Its database tests own amounts, eligibility, copy behaviour and the change stamp. | 550–750 / 300–450 |
| 4 | 5a–5c · menu documents, publication, Preview and their readers | Publishing or queueing a full menu captures its set menu. Test draft edits before republish, refusals and live corrections. | 480–650 / 260–380 |
| 5 | 6a–6b and 7 · zone offers, management routes and dashboard client | A zone serves the copies and can read a recorded version. Zone tests own stable keys, course and availability overlays, and newest-copy choice. Route tests own request and response shapes, refusals and the management-origin guard. Include Task 11's picker filters here so the new kind stays out of ordinary choices when the API accepts it. | 550–800 / 320–470 |
| 6 | 8a–8b and 10 · Menus screen, terms and inclusion lines | Managers can create and edit a draft and see what needs fixing. Browser tests own form, draft-leave, Preview and accessibility behaviour. Put Task 9's VAT wording here for the terms form and start the two guide sections with the available controls. | 550–800 / 250–380 |
| 7 | 9 · dish, variant and copy controls | Managers can complete a draft's dishes, including its course choices. Reuse the product picker and inline-price editor. Browser tests exercise each save path and its visible results, including the line-change messages. Extend both guide sections. | 500–700 / 220–340 |
| 8 | 11 remainder · structure table, Menus screen and guides | Managers can place the draft and publish the full menu. Check the new member controls, both guides, and a real create, place and publish through the zone offers read. A surcharge edit must reach the read only after republishing. | 230–380 / 110–190 |

Reuse the existing menu root, offers, variant overrides, publication and live-offer reads. Use
the current plan's defaults for open owner questions. Keep the setup flow behind the existing
management boundary. Publish through the full menu's existing action. Update A1515's backlog
entry once the final checkpoint works. Each PR advances the next checkpoint from main, with its
own focused checks and a target of three hours to open. The line ranges are estimates.
