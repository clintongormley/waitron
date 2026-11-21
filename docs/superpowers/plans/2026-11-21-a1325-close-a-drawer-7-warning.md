# 7. Warn after closing and include closes in the daily email

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 6. Estimate 350 production and 300 test
lines. A missed drawer close appears in the dashboard after closing. The existing daily email adds
closes, cash differences and warnings already due.

In `apps/server/src/alert-sources.ts`, show a drawer with cash movement that its latest finished
close has yet to cover. The warning is due one hour after the day's latest department closing time.
Use the venue's business-day start on days without department hours. Include net-zero movement and
unfinished counts. For a drawer with cash and no eligible assigned till, tell the manager to assign
a till so staff can close it. Keep deleted drawers in history. A finished close clears its warning.
The warning recurs daily while due and works with mail disabled.

Reuse `apps/server/src/close-of-day.ts` and `daily-report-mail.ts`. Keep the existing opt-in
recipients, business-day dedupe key and send after the automatic bill-issue pass. Include closes in
the ended business day and their differences, even if they occurred on a day with no sales. A day
without a close still gets its Sales email. Use the same Sales reader at send time. Reuse the
existing recent-day-only catch-up rule and include a Sales history link to find earlier closes.
Register the alert and EN/ES wording and update both guides.

Fail first in a focused drawer warning test for the closing-time cutoff and no-hours fallback, a
later finish, net-zero versus card-only activity and an unassigned or deleted drawer. Extend `daily-report-mail.test.ts` for close
details, no close, eligible recipients and both languages. Run `close-of-day.test.ts` to prove
the email still follows bill issuance and the same key avoids a duplicate after restart. Run the
alert inventories. No schema change.
