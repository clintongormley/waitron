# Data protection and legal compliance — detail

The open entries are listed in [the backlog](../backlog.md), under "Data protection and legal
compliance". This file holds their full text.

## A664 — archive or delete a venue's old data once it no longer has to be kept

- **A664 — archive or delete a venue's old data once it no longer has to be kept (owner,
  2026-10-14; open).** A way to archive or delete data across the whole venue as it ages past the
  point where it must be kept, for fiscal or any other purpose. Today nothing is deleted on a
  schedule; print jobs, for one, are kept forever (the retention entry under "The virtual PDF
  printer" in [printers.md](printers.md), which settles one month for print jobs on its own).
  1. **Research first, from primary sources, with a provenance row for each period:** how long
     invoices and the Veri\*Factu records must be kept, the accounts and commercial records, the
     working-time record, payment and card-reader records, and how long personal data (customers'
     names, tax IDs and email addresses on full invoices, staff details) may be kept under the
     RGPD — a ceiling as well as a floor. The RGPD part belongs with the data-protection track in
     the backlog's "The advisor gap".
  2. **Then design, table by table:** how long it is kept, and what happens after — archived (to
     the backup destination, as an encrypted file the owner can still open and show an inspector)
     and then deleted, or simply deleted. Write it as a spec agreed with the owner and the asesor
     before any code.
  3. **Constraints the design must meet:**
     - The append-only tables refuse updates and deletes by trigger (CLAUDE.md §5: do not work
       around them), so removing old fiscal records needs a deliberate, designed path.
     - The fiscal record chain is hash-chained; whatever stays must still be verifiable once its
       oldest records are gone.
     - Some keys refuse a delete: `receipt_reprints` points at `print_jobs` with `ON DELETE
       RESTRICT` (read, not run).
     - Deleted rows remain in the backups and the bucket copy until they age out of those too; say
       how long each keeps them.
