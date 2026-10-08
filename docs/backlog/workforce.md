# Working time and staff — detail

The open entries are listed in [the backlog](../backlog.md), under "Working time and staff". This file holds
their full text.

## A shift that runs past midnight (22:00–02:00) is refused as `shift.invalid`

- **Shift times are stored in one spelling — DONE (W22, #1134); left open,** found by #1134's
  review and not taken there: the dashboard's shift dialog
  (`apps/dashboard/src/widgets/shift-dialog.ts`) builds the end time on the START's day, so a
  shift that runs past midnight (22:00–02:00) is refused as `shift.invalid` — as it was before
  #1134. And an edit keeps the shift's stored offsets, so moving a shift across a summer-time
  change keeps the old offset. Next action: let the dialog put the end on the next day when it
  is not after the start, and derive each offset from the venue's time zone for the date.
