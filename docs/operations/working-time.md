# Clocking, corrections and working-time exports

Use a device that allows clocking. When you sign in, choose **Clock in**, or **Cancel** to
use the till without clocking in. During your shift, open your name menu, inside **More** on a
narrow handheld, to start or end a break, open **My hours**, or **Clock out**. Clocking out
also signs you out.

## Fix a missing or incorrect time

Answer working-time questions when you sign in. For an automatic clock-out, choose
**That's right**, or **No, I left at…** to request another time. For another correction,
open **My hours**, select the day and choose **Fix my hours**. Enter the corrected times
and the reason, then send the request.

A manager reviews requests in the dashboard's **Hours**. If a manager proposes a change,
review it when you sign in and accept it or disagree. Sending a request and accepting a
manager's proposal are separate actions; check the recorded day afterwards.

## Download the working-time record

In the dashboard's **Hours**, choose **Export working-time record**.

1. Set **From** and **Before**. From is included; Before is excluded. For a complete October,
   choose 1 October through Before 1 November.
2. Choose **Everyone** or one person, and **Standard** or **Representatives**.
3. Choose **PDF** or **CSV**, then **Download**.

Use the access your account has been given. The export dialog's representative version is
a distinct choice; it does not give its reader access to other dashboard actions.

## Where the actions live

The [clock-in screen](../../apps/till/src/screens/till-clock-in-screen.ts),
[working-time questions](../../apps/till/src/screens/till-attendance-questions.ts),
[corrections screen](../../apps/dashboard/src/screens/attendance-corrections-screen.ts) and
[export dialog](../../apps/dashboard/src/widgets/attendance-export-dialog.ts) are the
current implementation references. See [staff accounts](../../apps/server/src/guide/en/staff.md)
for sign-in details and permissions.
