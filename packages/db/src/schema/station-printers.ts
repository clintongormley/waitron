import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * The KDS station → printer MAPPING (KDS-4 §2a, "Slice B" of kitchen printing). A many-to-many join:
 * a station has zero-or-more printers (a screen-less prep station gets paper; a group printer is
 * attached to every station), and a printer serves one-or-more stations. When a station's items fire
 * (KDS-1's fire point), a ticket prints at each printer attached to that station.
 *
 * Tenant-scoped, NOT location-scoped: the station (KDS-1) and the printer (Slice A) each already carry
 * the location, so the mapping needs only the tenant plus the two ids. The key is the identity —
 * PRIMARY KEY (tenant_id, station_id, printer_id), no surrogate id — because a (station, printer) pair
 * is present at most once and attach/detach is add/remove of exactly that row.
 *
 * `station_id` and `printer_id` are BARE uuids: their tenant-consistent composite FKs —
 * (tenant_id, station_id) → kitchen_stations(tenant_id, id) and (tenant_id, printer_id) →
 * printers(tenant_id, id) — are hand-written in the paired --custom migration (a bare column carries no
 * FK; both targets are other slices' tables), exactly as `print_jobs.printer_id` does. Those FKs keep a
 * mapping from ever pointing at another tenant's station or printer, independently of RLS.
 *
 * `.enableRLS()` emits only ENABLE ROW LEVEL SECURITY. The FORCE ROW LEVEL SECURITY, the
 * `station_printers_tenant_isolation` policy and the SELECT/INSERT/DELETE grant to `app_user` (DELETE,
 * not UPDATE — a mapping row is added or removed, never edited, the pairing-codes precedent in 0063)
 * are hand-written in the paired --custom migration. The `inmutabilidad` guard in
 * packages/fiscal-verifactu scans every tenant_id-bearing table for both flags, so a missing FORCE here
 * fails that suite, not this package's.
 */
export const stationPrinters = pgTable(
  "station_printers",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason the sibling schema files use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // Bare column: the tenant-consistent (tenant_id, station_id) → kitchen_stations(tenant_id, id)
    // composite FK is hand-written in the --custom migration.
    stationId: uuid("station_id").notNull(),
    // Bare column: the tenant-consistent (tenant_id, printer_id) → printers(tenant_id, id) composite FK
    // is hand-written in the --custom migration.
    printerId: uuid("printer_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.stationId, t.printerId],
      name: "station_printers_pk",
    }),
  ],
).enableRLS();
