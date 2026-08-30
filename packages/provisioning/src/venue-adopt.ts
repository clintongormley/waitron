import { getTableColumns, sql, type Table } from "drizzle-orm";
import {
  invoiceSeries,
  locations,
  nodes,
  tenants,
  tills,
  withTenant,
  type Database,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** A raw parent row — every column, inserted VERBATIM. Keys are Drizzle's `$inferInsert` shape
 * (camelCase); Task 5's bundle assembler produces them via `select()`, so the keys already match. */
export interface VenueRow {
  [column: string]: unknown;
}

/** Part 1 of the mirror bundle (spec §3): the primary venue's parent rows, to be inserted on the
 * mirror with their explicit ids. Not `registro_sif`/`cadenas` — those arrive via sync. */
export interface AdoptVenueRows {
  tenant: VenueRow;
  locations: VenueRow[];
  nodes: VenueRow[];
  tills: VenueRow[];
  invoiceSeries: VenueRow[];
}

/** The five ids the bundle names for the mirror's `trading.env` (spec §3 Part 1b). `adoptVenue`
 * returns this unchanged once it has confirmed each id is present among the inserted rows. */
export interface AdoptResult {
  tenantId: string;
  locationId: string;
  tillId: string;
  nodeId: string;
  seriesId: string;
}

export interface AdoptVenueDeps {
  /** The OWNER connection to the mirror's database — the admin that ran `instance` and so owns the
   * tables, mirroring `applyVenue`'s `db`. In-test this is a PGlite superuser; the non-superuser
   * owner path under FORCE RLS is proven by a later real-Postgres e2e. */
  db: Database;
}

type MissingLabel = "tenant" | "location" | "node" | "till" | "series";

/**
 * Revive a bundle row's date-mode columns back to `Date`s before insert — table-agnostic, driven by the
 * Drizzle schema. The rows reach a cloud mirror as JSON over HTTP (`assembleMirrorBundle`'s `select()`
 * returns full rows, the endpoint `c.json`s them, and `fetchMirrorBundle` `response.json()`s them back),
 * so any column whose Drizzle driver value must be a `Date` — a `timestamp`/`date` declared `mode:"date"`,
 * whose `mapToDriverValue` calls `value.toISOString()` — arrives as an ISO STRING, and the insert then
 * throws `TypeError: value.toISOString is not a function`. Task 9's unit fixtures hand-built rows WITHOUT
 * any such column, so they never crossed JSON and never hit it; the headline adopt e2e (real HTTP
 * round-trip) is what surfaced it.
 *
 * We iterate the table's columns and revive every one whose `dataType === "date"` (the runtime signal
 * shared by `PgTimestamp` AND `PgDate` in `mode:"date"` — both stringify via `.toISOString()`; their
 * `mode:"string"` siblings report `dataType === "string"` and take the string verbatim). So a date-mode
 * column of ANY name on ANY of the five parent tables is handled, with no field list to keep in sync — a
 * future `updatedAt`/`activatedAt` cannot silently reintroduce the crash. A shallow copy is made only if
 * something is revived, so the caller's row object is untouched and every non-date value passes verbatim.
 */
function reviveRow(table: Table, row: VenueRow): VenueRow {
  let copy: VenueRow | undefined;
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    if (column.dataType === "date" && typeof row[key] === "string") {
      copy ??= { ...row };
      copy[key] = new Date(row[key] as string);
    }
  }
  return copy ?? row;
}

/**
 * Per-parent-table map of FK columns that reference a table which is NOT present on a mirror at adopt
 * time — the bundle carries only the FIVE parent tables, and a mirror serves READ-ONLY. Every column
 * here is a NULLABLE FK ($inferInsert camelCase key), nulled by `stripOutOfScopeFks` before insert
 * because a verbatim copy of the primary's non-null value raises a `23503` foreign-key violation. That
 * is not an `AppError`, so the adopt boundary maps it to an opaque `server.internal` 500 and rolls the
 * transaction back — the mirror cannot be provisioned. A freshly-provisioned venue leaves both NULL
 * (which is why the fixtures/e2e passed before a real trading venue was modelled), but a real one sets
 * them, so this is load-bearing for the actual deli target.
 *
 *   - `locations.catalogueId` → `catalogues` (tenant-consistent composite FK `locations_catalogue_fk`
 *     `(tenant_id, catalogue_id)`, migration 0078 — 0028's single-column FK was replaced). `catalogues`
 *     IS one of the synced tables, but sync only starts AFTER the mirror reboots
 *     into mirror mode; at adopt (setup mode) `catalogues` is EMPTY. And `locations` is NOT synced, so
 *     once the catalogue rows do arrive by sync the pointer is never restored — the mirror's location
 *     permanently loses its menu pointer. That is a v1 disaster-recovery FIDELITY limitation, not a
 *     correctness fault: a mirror never sells, and no read-only dashboard path resolves a menu through
 *     this column (see the C2b report). Carrying `catalogues` in the bundle to restore it is a future
 *     owner decision, not this fix.
 *   - `tills.receiptPrinterId` → `printers` (composite FK `tills_receipt_printer_fk`, migration 0068).
 *     `printers` is NOT in the sync registry (`packages/sync/src/registry.ts`) — it NEVER arrives on a
 *     mirror. A mirror has no printer; it prints nothing.
 *
 * A future parent-table FK to an out-of-scope table is a one-line addition here with its own reason.
 */
const OUT_OF_SCOPE_FK_COLUMNS = new Map<Table, readonly string[]>([
  [locations, ["catalogueId"]],
  [tills, ["receiptPrinterId"]],
]);

/**
 * Null the out-of-scope FK columns (see `OUT_OF_SCOPE_FK_COLUMNS`) on a bundle row before insert. A
 * shallow copy is made only if something is nulled, so a row that already carries NULL/omits the
 * column (a freshly-provisioned venue) passes through untouched. Table lookup is by Drizzle table
 * identity; a table with no out-of-scope FK (tenants/nodes/invoiceSeries) is a no-op.
 */
function stripOutOfScopeFks(table: Table, row: VenueRow): VenueRow {
  const columns = OUT_OF_SCOPE_FK_COLUMNS.get(table);
  if (columns === undefined) return row;
  let copy: VenueRow | undefined;
  for (const key of columns) {
    if (row[key] != null) {
      copy ??= { ...row };
      copy[key] = null;
    }
  }
  return copy ?? row;
}

/** Prepare a bundle row for insert: revive date-mode columns (JSON round-trip) AND null the
 * out-of-scope FK columns. The two transforms touch disjoint columns, so order is immaterial. */
function prepareRow(table: Table, row: VenueRow): VenueRow {
  return stripOutOfScopeFks(table, reviveRow(table, row));
}

/**
 * Provisions a cloud MIRROR by inserting the primary venue's parent rows — tenant, locations, nodes,
 * tills, invoice_series — with the primary's EXPLICIT ids, so the rows that later arrive by sync
 * resolve their foreign keys. One `withTenant` transaction, in FK order, each insert
 * `ON CONFLICT (id) DO NOTHING` for idempotency (a re-adopt of the same bundle inserts nothing).
 *
 * It deliberately does NOT `registerSif` and does NOT `seed-admin` (contrast `applyVenue`). Spec §5 /
 * CLAUDE.md §5: `registerSif` mints a fresh installation number and NULLs the chain-head pointer,
 * which on a mirror would fork a SECOND, unrecoverable hash chain for the same venue. The
 * `registro_sif`/`cadenas` rows arrive on the mirror through sync carrying the primary's real
 * installation number and chain — never from provisioning. `adoptVenue` inserts only the identity
 * scaffold those pulled rows need.
 *
 * The tenant scope is adopted from `designated.tenantId`, so every WITH CHECK
 * (`tenant_id = current_tenant_id()`) is satisfied by the rows this run inserts, and the designated-id
 * read-back below runs under that same scope — required so the check passes under FORCE RLS as the
 * owner (the later e2e's role), where a scopeless SELECT would see nothing.
 */
export async function adoptVenue(
  rows: AdoptVenueRows,
  designated: AdoptResult,
  deps: AdoptVenueDeps,
): Promise<AdoptResult> {
  return withTenant(deps.db, designated.tenantId, async (tx) => {
    await tx
      .insert(tenants)
      .values(prepareRow(tenants, rows.tenant) as typeof tenants.$inferInsert)
      .onConflictDoNothing({ target: tenants.id });
    for (const row of rows.locations) {
      await tx
        .insert(locations)
        .values(prepareRow(locations, row) as typeof locations.$inferInsert)
        .onConflictDoNothing({ target: locations.id });
    }
    for (const row of rows.nodes) {
      await tx
        .insert(nodes)
        .values(prepareRow(nodes, row) as typeof nodes.$inferInsert)
        .onConflictDoNothing({ target: nodes.id });
    }
    for (const row of rows.tills) {
      await tx
        .insert(tills)
        .values(prepareRow(tills, row) as typeof tills.$inferInsert)
        .onConflictDoNothing({ target: tills.id });
    }
    for (const row of rows.invoiceSeries) {
      await tx
        .insert(invoiceSeries)
        .values(prepareRow(invoiceSeries, row) as typeof invoiceSeries.$inferInsert)
        .onConflictDoNothing({ target: invoiceSeries.id });
    }

    // Read each designated id back inside the tenant scope: a malformed bundle whose row arrays did
    // not carry a row with a designated id would leave the mirror pointed at a till/series that does
    // not exist. Fail loudly (and roll the transaction back — never leave a half-provisioned mirror)
    // rather than let it surface confusingly at first sale.
    await assertPresent(tx, "tenant", tenants, designated.tenantId);
    await assertPresent(tx, "location", locations, designated.locationId);
    await assertPresent(tx, "node", nodes, designated.nodeId);
    await assertPresent(tx, "till", tills, designated.tillId);
    await assertPresent(tx, "series", invoiceSeries, designated.seriesId);

    return designated;
  });
}

/** SELECT 1 for `id` in `table`; throw `provisioning.adopt_incomplete` naming `missing` if absent. */
async function assertPresent(
  tx: Transaction,
  missing: MissingLabel,
  table: typeof tenants | typeof locations | typeof nodes | typeof tills | typeof invoiceSeries,
  id: string,
): Promise<void> {
  const found = await tx
    .select({ present: sql<number>`1` })
    .from(table)
    .where(sql`${table.id} = ${id}`)
    .limit(1);
  if (found.length === 0) throw new AppError("provisioning.adopt_incomplete", { missing });
}
