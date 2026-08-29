import { sql } from "drizzle-orm";
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
 * Revive a bundle row's `created_at` audit column back to a `Date` before insert. The rows reach a
 * cloud mirror as JSON over HTTP (`assembleMirrorBundle`'s `select()` returns full rows, the endpoint
 * `c.json`s them, and `fetchMirrorBundle` `response.json()`s them back), so any `timestamp(mode:"date")`
 * column — `created_at` on `tenants` and `nodes` today, the only two on these five parent tables —
 * arrives as an ISO STRING, and Drizzle's date-mode insert then calls `.toISOString()` on that string
 * and throws `TypeError: value.toISOString is not a function`. Task 9's unit fixtures hand-built rows
 * WITHOUT `createdAt`, so they never crossed JSON and never hit this; the headline adopt e2e (real HTTP
 * round-trip) is what surfaced it. A shallow copy so the caller's row object is untouched.
 */
function reviveRow<T extends VenueRow>(row: T): T {
  if (typeof row.createdAt === "string") {
    return { ...row, createdAt: new Date(row.createdAt) };
  }
  return row;
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
      .values(reviveRow(rows.tenant) as typeof tenants.$inferInsert)
      .onConflictDoNothing({ target: tenants.id });
    for (const row of rows.locations) {
      await tx
        .insert(locations)
        .values(reviveRow(row) as typeof locations.$inferInsert)
        .onConflictDoNothing({ target: locations.id });
    }
    for (const row of rows.nodes) {
      await tx
        .insert(nodes)
        .values(reviveRow(row) as typeof nodes.$inferInsert)
        .onConflictDoNothing({ target: nodes.id });
    }
    for (const row of rows.tills) {
      await tx
        .insert(tills)
        .values(reviveRow(row) as typeof tills.$inferInsert)
        .onConflictDoNothing({ target: tills.id });
    }
    for (const row of rows.invoiceSeries) {
      await tx
        .insert(invoiceSeries)
        .values(reviveRow(row) as typeof invoiceSeries.$inferInsert)
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
