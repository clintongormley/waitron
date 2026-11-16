import { createHash } from "node:crypto";
import { compareBackupTables } from "@waitron/db";
import { sniffImageType } from "@waitron/menu";
import type { BackupVerificationContribution } from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { MEDIA_TABLES } from "./tables.js";

const immutableTables = ["media_blobs"];
export const MEDIA_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: [...MEDIA_TABLES],
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
      policies: MEDIA_TABLES.map((table) => ({
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
  const blobs = await has(query, "media_blobs");
  if (blobs)
    for await (const row of query.rows("select * from media_blobs")) {
      if (
        !(row.bytes instanceof Uint8Array) ||
        row.hash !== digest(row.bytes) ||
        sniffImageType(row.bytes) !== row.format
      )
        return false;
    }
  if (images)
    for await (const row of query.rows("select * from media_images")) {
      const names = jsonObject(row.names);
      if (names === null || Object.values(names).some((value) => typeof value !== "string"))
        return false;
      const original = blobs
        ? await first(query, "select format from media_blobs where hash=?", [row.original_hash!])
        : undefined;
      if (!original || row.filename !== `${row.original_hash}.${original.format}`) return false;
      if (
        row.source_hash !== null &&
        (!blobs ||
          !(await first(query, "select 1 from media_blobs where hash=?", [row.source_hash!])))
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
  async function reference(value: unknown): Promise<boolean> {
    if (value === null || value === undefined) return true;
    return (
      typeof value === "string" &&
      images &&
      blobs &&
      (await first(
        query,
        "select 1 from media_images i join media_blobs b on b.hash=i.original_hash where i.filename=?",
        [value],
      )) !== undefined
    );
  }
  for (const [table, column] of [
    ["products", "image"],
    ["sections", "image"],
    ["section_members", "folder_image"],
  ] as const) {
    if (!(await has(query, table))) continue;
    for await (const row of query.rows(`select ${ident(column)} as value from ${ident(table)}`))
      if (!(await reference(row.value))) return false;
  }
  if (await has(query, "menu_version_images"))
    for await (const row of query.rows(
      "select mvi.filename from menu_version_images mvi join menu_releases r on r.version_id=mvi.version_id where r.state in ('live','queued')",
    ))
      if (!(await reference(row.filename))) return false;
  if (await has(query, "departments")) {
    for await (const row of query.rows(
      "select receipt_logo_image_id as id from departments where receipt_logo_image_id is not null",
    )) {
      if (
        typeof row.id !== "string" ||
        !images ||
        !blobs ||
        !(await first(
          query,
          "select 1 from media_images i join media_blobs b on b.hash=i.original_hash where i.id=?",
          [row.id],
        ))
      )
        return false;
    }
  }
  return true;
}
