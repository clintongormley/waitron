# 7. Warn and email after the business day ends

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 5. Estimate 350 production and 300 test
lines. A missed drawer close appears in the dashboard and the existing daily email adds closes,
cash differences and due warnings. This smaller slice awaits the watcher's decision on replacing
the design's department-hours schedule and weekly/off setting.

Use the existing business-day boundary. In `apps/server/src/alert-sources.ts` show a drawer with
cash movement from an ended day that its latest finished close has yet to cover. Include net-zero
movement and unfinished counts. Use the same drawer assignment rule as the till. A deleted drawer
or one with no eligible assigned till appears only in history, where the manager can see why and
assign it again when appropriate. A finished close clears its warning. The check never gates sales
or depends on enabling mail.

Reuse `apps/server/src/close-of-day.ts` and `daily-report-mail.ts`. Keep the existing opt-in
recipients, business-day dedupe key and send after the automatic bill-issue pass. Include closes in
the ended business day and their differences, even if they occurred on a day with no sales. A day
without a close still gets its Sales email. Use the same Sales reader at send time. Reuse the
existing recent-day-only catch-up rule and include a Sales history link to find earlier closes.
Register the alert and EN/ES wording and update both guides.

Fail first in a focused drawer warning test for a missed close, later finish, net-zero versus
card-only activity and an unassigned/deleted drawer. Extend `daily-report-mail.test.ts` for close
details, no close, eligible recipients and both languages. Run `close-of-day.test.ts` to prove
the email still follows bill issuance and the same key avoids a duplicate after restart. Run the
alert inventories. No schema change.
