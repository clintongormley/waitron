// Side-effect only: keeps this host's `station.*` codes (errors.ts) reachable from the file that
// throws them — the reachability convention kitchen.ts/tables.ts follow. See errors.ts. The other code
// this file throws, `printer.not_found`, is declared in @waitron/printing's OWN errors.ts and reaches
// the type program here through the `@waitron/printing` import below (its barrel side-effect-imports
// "./errors.js"), the same way print-api.ts reaches the printing codes through its printing imports.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { kitchenStations, printers, stationPrinters } from "@waitron/db";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PrintConfig } from "@waitron/printing";

// KDS-4 Slice B (design §3a) — the station → printer MAPPING verbs. `station_printers` is a
// tenant-scoped many-to-many (Task 1): a station has zero-or-more printers (a screen-less prep station
// gets paper; a group printer is attached to every station) and a printer serves one-or-more stations.
// These are CONFIG verbs — plain live-check + INSERT/DELETE on the caller's transaction under its
// tenant/app_user scope; the `printer.manage` gate is applied at the ROUTE layer (Task 5), exactly as
// the kitchen.ts station/course verbs rely on RLS + the route's `authorizeManager` rather than gating
// inside the verb. The scope is `PrintConfig` (the tenant + location the till/route carries), the same
// type `enqueuePrintJob`/`createPrinter` run under — the mapping itself is tenant-scoped (the station
// and printer each already carry the location), so only `cfg.tenantId` narrows the writes here.

/** The mapping row as the dashboard printer-editor and the mirrored station read consume it (design §5,
 *  decision R-F) — just the pair of ids; the tenant is implicit in the scope. */
export interface StationPrinter {
  stationId: string;
  printerId: string;
}

/**
 * Attach `printerId` to `stationId` (design §3a) — record that a fire at this station prints a ticket
 * at this printer. Both ends must be LIVE first:
 *
 *  - the STATION must exist in this tenant and be `active` — else `station.not_found`. Deactivated /
 *    absent / another tenant's (RLS-hidden) all fold into the one code, the shape kitchen.ts's
 *    `requireLiveStation` uses. Scoped by `cfg.tenantId` (not location): the mapping is tenant-scoped
 *    and the tenant-consistent composite FK (station_printers_station_fk) is the integrity backstop.
 *  - the PRINTER must exist in this tenant and be `active` — else `printer.not_found` (param `{ id }`,
 *    the printing package's own code). "Live" is determined EXACTLY as `enqueuePrintJob` does it
 *    (`active = true`): a deactivated printer is not an enqueue target, so it is not an attach target
 *    either — no point wiring a fire to a printer the outbox will refuse.
 *
 * Then INSERT the `(tenant_id, station_id, printer_id)` row with `ON CONFLICT DO NOTHING`, so attaching
 * an already-attached pair is a silent no-op rather than a 23505 — the idempotency the config UI's
 * multi-select relies on (re-saving a selection that already holds the pair must not error). Both
 * predicates bind as `$n` (never concatenated); the explicit `tenant_id` filter on each live-check is
 * belt-and-braces beside the tx's RLS scoping, the enqueuePrintJob/kitchen.ts shape.
 */
export async function attachPrinterToStation(
  tx: Transaction,
  cfg: PrintConfig,
  { stationId, printerId }: StationPrinter,
): Promise<void> {
  const [live] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.tenantId, cfg.tenantId),
        eq(kitchenStations.id, stationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (live === undefined) throw new AppError("station.not_found", { stationId });

  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(
      and(
        eq(printers.tenantId, cfg.tenantId),
        eq(printers.id, printerId),
        eq(printers.active, true),
      ),
    );
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  await tx
    .insert(stationPrinters)
    .values({ tenantId: cfg.tenantId, stationId, printerId })
    .onConflictDoNothing();
}

/**
 * Detach `printerId` from `stationId` (design §3a) — a PURE idempotent DELETE (controller ruling R-E).
 * Deliberately does NOT validate that the station or printer are still live: a mapping to a DEACTIVATED
 * station/printer must remain detachable so the config can be cleaned up after either end is retired.
 * Deleting a mapping that is not there affects zero rows and is a no-op, never an error. Scoped by
 * `cfg.tenantId` (belt-and-braces beside RLS); all values bind as `$n`.
 */
export async function detachPrinterFromStation(
  tx: Transaction,
  cfg: PrintConfig,
  { stationId, printerId }: StationPrinter,
): Promise<void> {
  await tx
    .delete(stationPrinters)
    .where(
      and(
        eq(stationPrinters.tenantId, cfg.tenantId),
        eq(stationPrinters.stationId, stationId),
        eq(stationPrinters.printerId, printerId),
      ),
    );
}

/**
 * List this tenant's station→printer mappings (design §5, decision R-F) — serves the Task-5 dashboard
 * printer-editor's multi-select (which stations a printer serves) and the mirrored per-station read
 * (which printers a station prints to), so it takes an optional filter on either id:
 *
 *  - `filter.stationId` → only that station's printers;
 *  - `filter.printerId` → only the stations that printer serves;
 *  - both → the single pair (present or not); no filter → every mapping in the tenant.
 *
 * The `tenant_id` predicate is always present (belt-and-braces beside RLS); the two id predicates are
 * appended only when supplied, so an absent filter widens rather than matching NULL. Ordered by
 * `(station_id, printer_id)` for a stable surface. All values bind as `$n`.
 */
export async function listStationPrinters(
  tx: Transaction,
  cfg: PrintConfig,
  filter?: { stationId?: string; printerId?: string },
): Promise<StationPrinter[]> {
  const conditions: SQL[] = [eq(stationPrinters.tenantId, cfg.tenantId)];
  if (filter?.stationId !== undefined) {
    conditions.push(eq(stationPrinters.stationId, filter.stationId));
  }
  if (filter?.printerId !== undefined) {
    conditions.push(eq(stationPrinters.printerId, filter.printerId));
  }
  return tx
    .select({ stationId: stationPrinters.stationId, printerId: stationPrinters.printerId })
    .from(stationPrinters)
    .where(and(...conditions))
    .orderBy(stationPrinters.stationId, stationPrinters.printerId);
}
