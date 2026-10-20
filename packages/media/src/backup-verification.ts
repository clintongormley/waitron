import { createHash } from "node:crypto";
import { compareBackupTables } from "@waitron/db";
import { sniffImageType } from "@waitron/catalogue";
import type { BackupVerificationContribution } from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { MEDIA_CLASSIFICATION } from "./classification.js";

const immutableTables = ["media_image_data", "media_image_blobs"];
export const MEDIA_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: MEDIA_CLASSIFICATION.map((c) => c.table),
    immutableTables,
    checks: ["data"],
  },
  secrets: [],
  entries: [],
  effects: [],
  zeroSchema: "absent_tables_and_entries",
  targetOnly: "empty_after_migration",
  async verifyRestoredData(context) {
    const equal = await compareBackupTables({
      before: context.before,
      after: context.after,
      policies: MEDIA_CLASSIFICATION.map(({ table }) => ({
        table,
        immutable: immutableTables.includes(table),
        addedColumns: {},
      })),
    });
    const before = await checkMedia(context.before);
    const after = await checkMedia(context.after);
    const status = equal && before && after ? "passed" : "invalid";
    return { status, checks: [{ code: "data", status }] };
  },
};
function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
async function first(query: BackupQuery, statement: string, values: readonly BackupValue[] = []) {
  for await (const row of query.rows(statement, values)) return row;
  return undefined;
}
async function has(query: BackupQuery, table: string): Promise<boolean> {
  return (
    (await first(query, "select name from sqlite_schema where type='table' and name=?", [
      table,
    ])) !== undefined
  );
}
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function jsonObject(value: BackupValue | undefined): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const result: unknown = JSON.parse(value);
    return result !== null && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
}
function integer(value: BackupValue | undefined, min: number, max: number): boolean {
  return typeof value === "bigint"
    ? value >= BigInt(min) && value <= BigInt(max)
    : typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
async function checkMedia(query: BackupQuery): Promise<boolean> {
  const images = await has(query, "media_images");
  const data = await has(query, "media_image_data");
  const blobs = await has(query, "media_image_blobs");
  const edits = await has(query, "media_image_edits");
  if (images)
    for await (const row of query.rows("select * from media_images")) {
      const names = jsonObject(row.names);
      if (names === null || Object.values(names).some((value) => typeof value !== "string"))
        return false;
      const bytes = data
        ? (await first(query, "select bytes from media_image_data where image_id=?", [row.id!]))
            ?.bytes
        : null;
      if (!(bytes instanceof Uint8Array)) return false;
      const extension = sniffImageType(bytes);
      if (extension === null || row.filename !== `${digest(bytes)}.${extension}`) return false;
    }
  if (data)
    for await (const row of query.rows("select image_id from media_image_data")) {
      if (
        !images ||
        !(await first(query, "select 1 from media_images where id=?", [row.image_id!]))
      )
        return false;
    }
  if (blobs)
    for await (const row of query.rows("select * from media_image_blobs")) {
      if (
        !(row.bytes instanceof Uint8Array) ||
        sniffImageType(row.bytes) !== "webp" ||
        row.hash !== digest(row.bytes)
      )
        return false;
    }
  if (edits)
    for await (const row of query.rows("select * from media_image_edits")) {
      if (
        !images ||
        !(await first(query, "select 1 from media_images where id=?", [row.image_id!]))
      )
        return false;
      if (
        row.source_hash !== null &&
        (!blobs ||
          !(await first(query, "select 1 from media_image_blobs where hash=?", [row.source_hash!])))
      )
        return false;
      if (
        !integer(row.focus_x, 0, 10000) ||
        !integer(row.focus_y, 0, 10000) ||
        !integer(row.zoom, 100, 400) ||
        !integer(row.revision, 1, Number.MAX_SAFE_INTEGER)
      )
        return false;
      if (
        row.original_filename !== null &&
        (typeof row.original_filename !== "string" ||
          row.original_filename.length > 255 ||
          /[\0\r\n]/.test(row.original_filename))
      )
        return false;
    }
  async function reference(value: unknown, historical: boolean): Promise<boolean> {
    if (value === null || value === undefined) return true;
    if (typeof value !== "string") return false;
    if (
      images &&
      data &&
      (await first(
        query,
        "select 1 from media_images i join media_image_data d on d.image_id=i.id where i.filename=?",
        [value],
      ))
    )
      return true;
    return (
      historical &&
      /^[a-f0-9]{64}\.webp$/.test(value) &&
      blobs &&
      (await first(query, "select 1 from media_image_blobs where hash=?", [value.slice(0, 64)])) !==
        undefined
    );
  }
  for (const [table, column, nested] of [
    ["products", "image", null],
    ["sections", "image", null],
    ["section_members", "folder_overrides", "image"],
    ["menu_version_images", "filename", null],
    ["department_receipts", "receipt", "logo"],
  ] as const) {
    if (!(await has(query, table))) continue;
    for await (const row of query.rows(`select ${ident(column)} as value from ${ident(table)}`)) {
      if (nested !== null) {
        const object = jsonObject(row.value);
        if (object === null || !(await reference(object[nested], false))) return false;
      } else if (!(await reference(row.value, table === "menu_version_images"))) return false;
    }
  }
  return true;
}
