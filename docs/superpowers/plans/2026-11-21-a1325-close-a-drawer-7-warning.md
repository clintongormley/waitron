# 7. Warn when a drawer has been missed

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 6. Estimate 430 production and 380 test
lines. The dashboard names drawers left unclosed. Saving a close clears the warning.

Use `resolveDepartmentsDays` from venue-service to find the end of the last active department's
hours, including overnight service. The check is due one elapsed hour later. If the day has no
hours, use the boundary that ends that business day. Use the existing time-zone helpers for clock
changes. Check drawers that recorded cash since their last finish, including a net-zero movement.
Unfinished counts still need closing. Deleted drawers are skipped. Cash posted after a close
becomes eligible at its own next check. The warning never gates an action.

Add `apps/server/src/{drawer-close-schedule,drawer-close-settings}.ts` and use the existing job runner,
`boot.ts`, `job-catalogue.ts` and `alert-sources.ts`. Register the alert and EN/ES wording. Save daily
(default), weekly or off through the shared settings document and the existing venue configuration
permission. Add the dashboard choice and draft handling to drawer history. Confirm when Weekly
first warns with the watcher. Keep the daily report mail setting independent.

Fail first in server `drawer-close-schedule.test.ts` for latest end, overnight, no hours, a clock
change, net-zero cash, closing and reopening activity, and cadence. Server job tests own restart and
stepdown. Run the alert and settings tests plus the code inventories. Dashboard tests own the draft,
save, refusal and display. Update both guides. No schema change.
