import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { compareBackupTables, type BackupTablePolicy } from "@waitron/db";
import type { BackupModuleStatus, BackupVerificationContribution } from "@waitron/module";
import type { BackupQuery, BackupValue } from "@waitron/store";
import { CATALOGUE_CLASSIFICATION } from "./classification.js";
import { documentImages, menuDocumentHash, MENU_DOCUMENT_FORMAT } from "./menu-document.js";
import type { MenuDocument } from "./menu-document-types.js";
import * as schema from "./schema/index.js";

const immutableTables = ["menu_versions", "menu_version_images"];
export const CATALOGUE_BACKUP_VERIFICATION: BackupVerificationContribution = {
  version: 1,
  publicEvidenceDigest: null,
  data: {
    kind: "custom",
    tables: CATALOGUE_CLASSIFICATION.map((c) => c.table),
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
      policies: CATALOGUE_CLASSIFICATION.map(({ table }): BackupTablePolicy => ({
        table,
        immutable: immutableTables.includes(table),
        addedColumns:
          table === "content_suggestion_jobs" ? { collect_cursor: null, collected_refs: "[]" } : {},
      })),
    });
    const before = await checkCatalogue(context.before);
    const after = await checkCatalogue(context.after);
    const status =
      before === "unsupported" || after === "unsupported"
        ? "unsupported"
        : !equal || before === "invalid" || after === "invalid"
          ? "invalid"
          : "passed";
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
async function checkCatalogue(query: BackupQuery): Promise<BackupModuleStatus> {
  let status: BackupModuleStatus = "passed";
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const config = getTableConfig(value);
    if (!(await has(query, config.name))) continue;
    for (const key of config.foreignKeys) {
      const { columns, foreignColumns, foreignTable } = key.reference();
      const present = columns.map((c) => `child.${ident(c.name)} is not null`).join(" and ");
      const parent = getTableConfig(foreignTable).name;
      if (!(await has(query, parent))) {
        if (
          await first(query, `select 1 from ${ident(config.name)} child where ${present} limit 1`)
        )
          status = "invalid";
        continue;
      }
      const match = columns
        .map((c, i) => `parent.${ident(foreignColumns[i]!.name)}=child.${ident(c.name)}`)
        .join(" and ");
      if (
        await first(
          query,
          `select 1 from ${ident(config.name)} child where ${present} and not exists (select 1 from ${ident(parent)} parent where ${match}) limit 1`,
        )
      )
        status = "invalid";
    }
  }
  if (!(await has(query, "menu_versions"))) return status;
  const hasImages = await has(query, "menu_version_images");
  for await (const row of query.rows("select * from menu_versions")) {
    if (typeof row.document !== "string") {
      status = "invalid";
      continue;
    }
    let document: MenuDocument;
    try {
      document = JSON.parse(row.document) as MenuDocument;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      status = "invalid";
      continue;
    }
    if (document === null || typeof document !== "object" || Array.isArray(document)) {
      status = "invalid";
      continue;
    }
    if (document.format !== MENU_DOCUMENT_FORMAT) {
      if (typeof document.format === "number") return "unsupported";
      status = "invalid";
      continue;
    }
    let images: string[];
    try {
      images = documentImages(document);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      status = "invalid";
      continue;
    }
    if (
      document.menuId !== row.menu_id ||
      menuDocumentHash(document) !== row.content_hash ||
      images.some((image) => typeof image !== "string")
    )
      status = "invalid";
    const stored: string[] = [];
    if (hasImages)
      for await (const image of query.rows(
        "select filename from menu_version_images where version_id=? order by filename",
        [row.id!],
      )) {
        if (typeof image.filename !== "string") {
          status = "invalid";
          continue;
        }
        stored.push(image.filename);
      }
    if (images.length !== stored.length || images.some((image, i) => image !== stored[i]))
      status = "invalid";
  }
  return status;
}
