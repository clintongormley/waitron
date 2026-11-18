# Hold dashboard alerts while the account menu is open

You can finish using the account menu while the bell shows the latest alert count. When the menu closes, the alert appears with its full countdown. This resolves the last Task 16 bullet in `docs/backlog/till.md`. Claude reviewed the first plan. The watcher cleared this revised behavior in Lane D’s questions.md at 07:39 on 18 November 2026. Keep the existing toast stack. Leave other notices, modal behavior and menu focus alone.

- In `packages/ui/src/components/wt-toast.ts`, add a held state that uses the same rendering and countdown rules as the existing modal hold. In `wt-toast.test.ts`, prove a held toast stays out of both live regions and gets its full countdown on release. Check the held state with axe in both themes.
- In `wt-row-actions.ts`, report open and closed states from its existing popover lifecycle, including removal while open. Test the existing native menu paths in `wt-row-actions.test.ts`.
- In `apps/dashboard/src/dashboard-app.ts`, listen on the account menu and apply its state to the alert toast. A held alert leaves no spacing in the stack. In `dashboard-app.test.ts`, open the actual menu and deliver a live alert in both orders, at 390 and 1280 px. Check the bell count during the hold and that the alert reappears after closure. Look in both themes and languages and run the download stack and floor-plan regressions.
- Record the menu behavior in `docs/developers/design-system.md` and remove the resolved bullet and its index phrase. Estimate 30–50 production lines and 80–130 test lines.
