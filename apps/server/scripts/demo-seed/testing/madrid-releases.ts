import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";
import { madridWithRenamedColumns } from "./madrid-renamed-columns.js";

export function madridWithMenuReleases(
  original: CanonicalMadridSemantics,
): CanonicalMadridSemantics {
  const result = madridWithRenamedColumns(original, {
    menu_versions: { published_at: "created_at", published_by: "created_by" },
  });
  const pointers = result.tables.menu_publications!;
  const releases = new Map<string, Record<string, unknown>>();
  for (const row of Object.values(result.tables.menu_scheduled_publications!.rows))
    releases.set(String(row.version_id), {
      version_id: row.version_id,
      menu_id: row.menu_id,
      state: row.state === "activated" ? "superseded" : row.state,
      activates_at: row.activates_at,
      cancelled_at: row.cancelled_at,
      cancelled_by: row.cancelled_by,
    });
  for (const row of Object.values(pointers.rows))
    releases.set(String(row.version_id), {
      version_id: row.version_id,
      menu_id: row.menu_id,
      state: "live",
      activates_at: row.published_at,
      cancelled_at: null,
      cancelled_by: null,
    });
  result.tables.menu_releases = {
    columns: ["version_id", "menu_id", "state", "activates_at", "cancelled_at", "cancelled_by"].map(
      (name) => ({
        name,
        type: "TEXT",
        notnull: name.startsWith("cancelled_") ? 0 : 1,
        dflt_value: null,
        pk: name === "version_id" ? 1 : 0,
      }),
    ),
    foreignKeys: pointers.foreignKeys,
    rows: Object.fromEntries(
      [...releases.values()]
        .map((row) => [stable(row), row])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ),
  };
  delete result.tables.menu_publications;
  delete result.tables.menu_scheduled_publications;
  result.tables = Object.fromEntries(
    Object.entries(result.tables).sort(([a], [b]) => a.localeCompare(b)),
  );
  return result;
}
