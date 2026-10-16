# Data protection and legal compliance — detail

The open entries are listed in [the backlog](../backlog.md), under "Data protection and legal
compliance". This file holds their full text.

## A664 — archive or delete a venue's old data once it no longer has to be kept

- **A664 — archive or delete a venue's old data once it no longer has to be kept (owner,
  2026-10-14; research complete 2026-10-16; proposed design awaiting owner and relevant adviser
  approval; implementation remains open).** Read the
  [proposed design](../superpowers/specs/2026-10-16-a664-data-retention-design.md),
  [primary-source register](../compliance/research/2026-10-16-a664-retention.md) and
  [complete static table inventory](../superpowers/specs/2026-10-16-a664-retention-table-inventory.md).
  The snapshot covers 208 application tables across 15 migration sets, including empty fiscal-none;
  revalidate it when implementation starts because other lanes can add migrations.

  The proposal uses record-specific statutory clocks and necessary-purpose limits, short operational
  windows, scoped holds, inspectable encrypted evidence archives and separate recovery-copy expiry.
  It covers personal text inside immutable snapshots, minimum worker identities, credentials,
  media, logs, exports, external copies and re-erasure before a restored copy is opened.
  Archive creation does not make the protected source removable. Triggers, chains, numbering and
  declared/non-FK dependencies require a later approved storage separation for protected retirement;
  no bypass, whole-folder rotation or artificial new chain is authorised.

  The owner’s single approach question and two dated examples are in the design. Venue-specific
  [Q48 and specialist referrals](../compliance/asesor-questions.md#q48-a664-retention-and-evidence-process-added-2026-10-16)
  separate fiscal/commercial, labour and privacy decisions. Owner approval is not legal clearance. No A664 product code, including reporting, starts before the owner and relevant advisers agree the design.
  No implementation, deletion, product test or migration has been performed by this documentation
  work. The existing [finished print-job month choice](printers.md) remains subject to audit/replay
  dependencies. A664 stays open for the approved build and its verification; the broader privacy
  programme remains in the backlog’s “The advisor gap”.
