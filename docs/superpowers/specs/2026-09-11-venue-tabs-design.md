# Venue operations tabs and row management

You manage one concern at a time under Venue operations: Status, Departments, Menus,
Service zones and menus, or Preparation routing. Status is the initial view. The selected
view uses `/manage/venue-operations/view/<key>` and follows refresh and browser history.

`wt-tabs` belongs to the shared Lit UI library. It accepts stable keys and localized labels,
projects named slots into associated tab panels, keeps inactive content mounted but hidden,
and supports arrow keys, Home and End. The strip scrolls horizontally on narrow screens.
The screen owns navigation; the component emits `wt-change` with the selected value.

Management lists use `wt-data-table`. A hamburger action menu offers creation at table level
and editing, deletion/deactivation and contextual actions at row level. Reuse the existing
dashboard action popover through a shared `wt-row-actions` primitive. Forms open in `wt-modal`
with required markers, field explanations, a localized error summary and Cancel/Save actions.
Failed writes retain the form. Successful writes refresh the model and close the editor.

Departments include an hours table; menus lead to a selected menu's products table. Zone rows
open policy editing or a menu-assignment table. Existing floor zones remain owned by Floor.
Department removal means deactivation; product removal means removing a menu offer. Edits use
server writes that retain the row identifier and enforce existing authorization and scope.
