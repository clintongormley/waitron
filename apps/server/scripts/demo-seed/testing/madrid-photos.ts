import { expect } from "vitest";
import type { DocumentMember, MenuDocument } from "@waitron/menu";
import {
  recomputeMadridHashes,
  stable,
  type CanonicalMadridSemantics,
  type MadridColumn,
} from "./madrid-semantics.js";

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

export function removeMadridSectionPhotos(
  seeded: CanonicalMadridSemantics,
  photos: ReadonlyMap<string, string>,
): void {
  const { sections, media_images, media_blobs, menu_versions, menu_version_images } = seeded.tables;
  const removed = new Set<string>();
  for (const [sectionId, filename] of photos) {
    const section = sections!.rows[sectionId]!;
    expect(section.image, sectionId).toBe(filename);
    section.image = null;
    if (removed.has(filename)) continue;
    removed.add(filename);

    const id = `@media_images:${stable([filename])}`;
    const [hash, format] = filename.split(".");
    expect(media_images!.rows[id]).toEqual({
      id,
      filename,
      names: section.names,
      created_at: "2026-10-08T10:00:00.000Z",
      updated_at: "2026-10-08T10:00:00.000Z",
      original_hash: hash,
      source_hash: null,
      focus_x: 5000,
      focus_y: 5000,
      zoom: 100,
      revision: 1,
      original_filename: null,
    });
    delete media_images!.rows[id];

    const blob = { hash, format, bytes: `sha256:${hash}` };
    const key = stable(blob);
    expect(media_blobs!.rows[key]).toEqual(blob);
    delete media_blobs!.rows[key];
  }

  for (const [versionId, version] of Object.entries(menu_versions!.rows)) {
    const names = new Set<string>();
    const removePhotosFrom = (members: readonly DocumentMember[]) => {
      for (const member of members) {
        if (member.kind !== "section") continue;
        const filename = photos.get(member.sectionId);
        if (filename !== undefined) {
          expect(member.image, `${versionId}/${member.sectionId}`).toBe(filename);
          member.image = null;
          names.add(filename);
        }
        removePhotosFrom(member.members);
      }
    };
    removePhotosFrom((version.document as MenuDocument).root.members);
    for (const filename of names) {
      const row = { version_id: versionId, filename };
      const key = stable(row);
      expect(menu_version_images!.rows[key]).toEqual(row);
      delete menu_version_images!.rows[key];
    }
  }
  recomputeMadridHashes(seeded);
}
