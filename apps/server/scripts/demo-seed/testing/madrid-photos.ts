import { stable, type CanonicalMadridSemantics, type MadridColumn } from "./madrid-semantics.js";

export function madridWithPhotos(original: CanonicalMadridSemantics): CanonicalMadridSemantics {
  const result = structuredClone(original);
  const images = result.tables.media_images!;
  const edits = new Map(
    Object.values(result.tables.media_image_edits!.rows).map((row) => [row.image_id, row]),
  );
  const defaults = {
    source_hash: null,
    focus_x: 5000,
    focus_y: 5000,
    zoom: 100,
    revision: 1,
    original_filename: null,
  };
  images.columns.push(
    ...Object.entries({ original_hash: null, ...defaults }).map(([name, value]): MadridColumn => ({
      name,
      type: typeof value === "number" ? "INTEGER" : "TEXT",
      notnull: name === "source_hash" || name === "original_filename" ? 0 : 1,
      dflt_value: typeof value === "number" ? String(value) : null,
      pk: 0,
    })),
  );
  images.foreignKeys = ["source_hash", "original_hash"].map((from, id) => ({
    id,
    seq: 0,
    table: "media_blobs",
    from,
    to: "hash",
    on_update: "NO ACTION",
    on_delete: "RESTRICT",
    match: "NONE",
  }));
  const blobs = new Map<string, Record<string, unknown>>();
  for (const row of Object.values(result.tables.media_image_blobs!.rows))
    blobs.set(String(row.hash), { hash: row.hash, format: "webp", bytes: row.bytes });
  const data = new Map(
    Object.values(result.tables.media_image_data!.rows).map((row) => [row.image_id, row.bytes]),
  );
  for (const row of Object.values(images.rows)) {
    const [hash, format] = String(row.filename).split(".");
    const edit = edits.get(row.id);
    row.original_hash = hash;
    for (const [name, fallback] of Object.entries(defaults)) row[name] = edit?.[name] ?? fallback;
    blobs.set(hash!, { hash, format, bytes: data.get(row.id) });
  }
  result.tables.media_blobs = {
    columns: ["hash", "format", "bytes"].map((name) => ({
      name,
      type: name === "bytes" ? "BLOB" : "TEXT",
      notnull: 1,
      dflt_value: null,
      pk: name === "hash" ? 1 : 0,
    })),
    foreignKeys: [],
    rows: Object.fromEntries(
      [...blobs.values()]
        .map((row) => [stable(row), row])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ),
  };
  delete result.tables.media_image_data;
  delete result.tables.media_image_blobs;
  delete result.tables.media_image_edits;
  result.tables = Object.fromEntries(
    Object.entries(result.tables).sort(([a], [b]) => a.localeCompare(b)),
  );
  return result;
}
