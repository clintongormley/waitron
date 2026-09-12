# Printer settings

2026-09-11 follow-up: [printer follow-ups](2026-09-11-printer-followups.md) adds delete confirmation,
active/disabled filtering and re-add, named switches, shadow-part cell styling, numeric timestamps
and a visual receipt preview. The original design/review below records the earlier text-only behavior.

Give hardware setup three readable tables: Print agents, Printers, and Recent print jobs. Add and
edit actions open the shared portrait `wt-modal`; Save and Cancel stay in its footer. Keep the
existing agent pairing flow inside the add modal. Adding a printer automatically scans every
supported connection type. One results table shows each device with an Add action on the right;
there is no type dropdown or manual connection form. Put device details beneath its name so the
Add action fits the portrait panel without horizontal scrolling. Registered devices are hidden from
the scan table; their last reported presence appears beneath their name in the printers table.

Agents show name, reported host, enabled/revoked status and last contact time. Name is editable;
host is reported by the agent on authenticated polling. Missing host means not reported, never a
name guessed to be a hostname. Delete revokes access while keeping the recorded identity.

Show Printers only after at least one agent is registered. Columns show name, pending jobs,
enabled/disabled status, last delivery time, receipt-printer assignment, connection type, address,
device ID and row actions. Poll ID belongs only to cloud-poll printer details. Pending jobs and last
delivery come from all tenant-scoped job history, not the recent-job sample. Delete deactivates the
printer and retains its history.

Recent jobs means the latest 100 records, not a time window. Label timestamps Queued at and
Delivered at. The existing attempt counter counts failed attempts, so label it accordingly.
Offer a safe text preview of the stored job, with explicit notice about omitted layout and graphics.
All reads and writes remain permission-checked and tenant-scoped.

Move station assignments, one-ticket-per-order, till receipt-printer assignments, location
auto-printing and cash-drawer policy to a separate Printing rules page. Preserve their write
behavior and tests; do not present unsourced default settings as persisted values.

Validation: failing browser tests first for table structure, conditional visibility, modal
open/cancel/save, validation and menu actions; preserve existing pairing/discovery and write-path
assertions. Backend tests cover hostname reporting, rename, aggregates and preview isolation.
Run affected package coverage, browser accessibility tests and the full repository gate.

2026-09-12 update: [Printer configuration tabs](2026-09-12-printer-configuration-tabs.md)
supersedes the Delete wording, stacked sections, manual pairing controls and latest-100-only
job list described here.
