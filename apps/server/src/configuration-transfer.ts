import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type { ConfigurationTransferTable, WaitronModule } from "@waitron/module";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive, type ArchiveEntry } from "./backup-archive.js";
import { writeFileAtomic } from "./fs-atomic.js";
import { MEDIA_FILENAME } from "./media-api.js";
import "./errors.js";

const ENTRY = "configuration.json";
const MAX_ROWS_PER_TABLE = 100_000;

export interface PreparedVenue {
  country: string;
  taxId: string;
  legalName: string;
  location: {
    id: string;
    name: string;
    invoiceLocales: string[];
    operationDescription: string;
    fiscalTerritory: string;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    province: string | null;
    timeZone: string;
    dayCutover: string;
    orderFlow: string;
    bumpMode: string;
    fireControl: string;
    receiptPrintMode: string;
    drawerOpenPolicy: string;
    catalogueId: string | null;
  };
  tillName: string;
  seriesCode: string;
  rectificativeSeriesCode: string;
}

export async function buildConfigurationBundle(
  db: Database | Transaction,
  source: { tenantId: string; locationId: string; tillId: string; nodeId: string },
  modules: readonly WaitronModule[],
  now: Date,
  moduleVersions: Record<string, number>,
): Promise<ConfigurationBundle> {
  const venue = await db.execute<
    PreparedVenue["location"] & {
      country: string;
      taxId: string;
      legalName: string;
      tillName: string;
      seriesCode: string | null;
      rectificativeSeriesCode: string | null;
    }
  >(sql`
    select
      t.country, t.tax_id as "taxId", t.legal_name as "legalName",
      l.id, l.name, l.invoice_locales as "invoiceLocales",
      l.operation_description as "operationDescription", l.fiscal_territory as "fiscalTerritory",
      l.address_line1 as "addressLine1", l.address_line2 as "addressLine2",
      l.postal_code as "postalCode", l.city, l.province, l.time_zone as "timeZone",
      l.day_cutover::text as "dayCutover", l.order_flow as "orderFlow", l.bump_mode as "bumpMode",
      l.fire_control as "fireControl", l.receipt_print_mode as "receiptPrintMode",
      l.drawer_open_policy as "drawerOpenPolicy", l.catalogue_id as "catalogueId",
      till.name as "tillName",
      max(s.code) filter (where s.purpose = 'standard') as "seriesCode",
      max(s.code) filter (where s.purpose = 'rectificative') as "rectificativeSeriesCode"
    from tenants t
    join locations l on l.tenant_id = t.id and l.id = ${source.locationId}
    join tills till on till.tenant_id = t.id and till.id = ${source.tillId}
    join nodes n on n.tenant_id = t.id and n.id = ${source.nodeId}
    join invoice_series s on s.tenant_id = t.id and s.node_id = n.id and s.retired_at is null
    where t.id = ${source.tenantId}
    group by t.id, l.id, till.id
  `);
  const row = venue.rows[0];
  if (row === undefined || row.seriesCode === null || row.rectificativeSeriesCode === null) {
    throw new AppError("setup.request_invalid", { field: "venue" });
  }
  const { country, taxId, legalName, tillName, seriesCode, rectificativeSeriesCode, ...location } =
    row;
  const transferred = await exportConfigurationTables(db, source.tenantId, modules);
  return {
    version: 1,
    createdAt: now.toISOString(),
    sourceTenantId: source.tenantId,
    venue: {
      country,
      taxId,
      legalName,
      location,
      tillName,
      seriesCode,
      rectificativeSeriesCode,
    },
    modules: moduleVersions,
    ...transferred,
  };
}

export async function applyPreparedLocation(
  tx: Transaction,
  target: { tenantId: string; locationId: string },
  location: PreparedVenue["location"],
): Promise<void> {
  const invoiceLocales = sql`array[${sql.join(
    location.invoiceLocales.map((locale) => sql`${locale}`),
    sql`, `,
  )}]::text[]`;
  await tx.execute(sql`
    update locations set
      invoice_locales = ${invoiceLocales},
      operation_description = ${location.operationDescription},
      order_flow = ${location.orderFlow},
      bump_mode = ${location.bumpMode},
      fire_control = ${location.fireControl},
      receipt_print_mode = ${location.receiptPrintMode},
      drawer_open_policy = ${location.drawerOpenPolicy},
      catalogue_id = ${location.catalogueId}
    where tenant_id = ${target.tenantId} and id = ${target.locationId}
  `);
}

export interface ConfigurationBundle {
  version: 1;
  createdAt: string;
  sourceTenantId: string;
  venue: PreparedVenue;
  modules: Record<string, number>;
  tables: Record<string, Array<Record<string, unknown>>>;
  reconnect: string[];
}

function declarations(modules: readonly WaitronModule[]): ConfigurationTransferTable[] {
  const tables: ConfigurationTransferTable[] = [];
  const names = new Set<string>();
  for (const module of modules) {
    const contribution = module.configurationTransfer;
    if (contribution === undefined) {
      throw new AppError("setup.request_invalid", { field: `module:${module.name}` });
    }
    if (contribution.kind === "none") continue;
    for (const table of contribution.tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(table.name) || names.has(table.name)) {
        throw new AppError("setup.request_invalid", { field: `table:${table.name}` });
      }
      names.add(table.name);
      tables.push(table);
    }
  }
  return tables;
}

/** Read only explicitly declared, tenant-scoped configuration rows from one consistent transaction. */
export async function exportConfigurationTables(
  db: Database | Transaction,
  tenantId: string,
  modules: readonly WaitronModule[],
): Promise<{ tables: ConfigurationBundle["tables"]; reconnect: string[] }> {
  const tables: ConfigurationBundle["tables"] = {};
  const reconnect: string[] = [];
  for (const declaration of declarations(modules)) {
    const result = await db.execute<{ row: Record<string, unknown> }>(sql`
      select to_jsonb(t) as row
      from ${sql.identifier(declaration.name)} t
      where t.tenant_id = ${tenantId}
    `);
    if (result.rows.length > MAX_ROWS_PER_TABLE) {
      throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
    }
    tables[declaration.name] = result.rows.map(({ row }) => {
      const copy = { ...row };
      for (const field of declaration.omit ?? []) delete copy[field];
      return copy;
    });
    if (declaration.reconnect && result.rows.length > 0) reconnect.push(declaration.name);
  }
  return { tables, reconnect };
}

function validateMediaFilename(filename: string): string {
  const expected = MEDIA_FILENAME.exec(filename)?.[0]?.split(".")[0];
  if (expected === undefined) {
    throw new AppError("setup.request_invalid", { field: `media:${filename}` });
  }
  return expected;
}

function validateMediaEntry(entry: ArchiveEntry): string {
  if (!entry.name.startsWith("media/")) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  const filename = entry.name.slice("media/".length);
  const expected = validateMediaFilename(filename);
  const actual = createHash("sha256").update(entry.bytes).digest("hex");
  if (expected === undefined || expected !== actual) {
    throw new AppError("setup.request_invalid", { field: `media:${filename}` });
  }
  return filename;
}

/** Capture only media filenames referenced by transferable product rows. Content-addressed names
 * make the database snapshot and these later reads one immutable logical snapshot. */
export async function collectConfigurationMedia(
  bundle: ConfigurationBundle,
  mediaDir: string,
): Promise<ArchiveEntry[]> {
  const names = [
    ...new Set(
      (bundle.tables.products ?? [])
        .map((row) => row.image)
        .filter((name): name is string => typeof name === "string"),
    ),
  ].sort();
  const entries = await Promise.all(
    names.map(async (name) => {
      validateMediaFilename(name);
      return { name: `media/${name}`, bytes: await readFile(join(mediaDir, name)) };
    }),
  );
  for (const entry of entries) validateMediaEntry(entry);
  return entries;
}

export function encodeConfigurationBundle(
  bundle: ConfigurationBundle,
  passphrase: string,
  media: ArchiveEntry[] = [],
): Buffer {
  if (passphrase.length < 12) {
    throw new AppError("setup.request_invalid", { field: "passphrase" });
  }
  for (const entry of media) validateMediaEntry(entry);
  return encryptArtifact(
    packArchive([{ name: ENTRY, bytes: Buffer.from(JSON.stringify(bundle), "utf8") }, ...media]),
    passphrase,
  );
}

function decodeConfigurationArchive(
  artifact: Uint8Array,
  passphrase: string,
): { bundle: ConfigurationBundle; media: ArchiveEntry[] } {
  const entries = unpackArchive(decryptArtifact(artifact, passphrase));
  if (entries[0]?.name !== ENTRY) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  const media = entries.slice(1);
  const seen = new Set<string>();
  for (const entry of media) {
    const filename = validateMediaEntry(entry);
    if (seen.has(filename)) throw new AppError("setup.request_invalid", { field: "artifact" });
    seen.add(filename);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(entries[0].bytes).toString("utf8"));
  } catch {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  const bundle = parseConfigurationBundle(value);
  const referenced = new Set(
    (bundle.tables.products ?? [])
      .map((row) => row.image)
      .filter((name): name is string => typeof name === "string"),
  );
  if (
    referenced.size !== media.length ||
    media.some((entry) => !referenced.has(entry.name.slice(6)))
  ) {
    throw new AppError("setup.request_invalid", { field: "media" });
  }
  return { bundle, media };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfigurationBundle(value: unknown): ConfigurationBundle {
  if (!isRecord(value) || value.version !== 1) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  const venue = value.venue;
  const location = isRecord(venue) ? venue.location : undefined;
  const modules = value.modules;
  const tables = value.tables;
  if (
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.sourceTenantId !== "string" ||
    !isRecord(venue) ||
    !isRecord(location) ||
    !isRecord(modules) ||
    Object.values(modules).some((version) => !Number.isInteger(version) || Number(version) < 0) ||
    !isRecord(tables) ||
    !Array.isArray(value.reconnect) ||
    value.reconnect.some((name) => typeof name !== "string")
  ) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  const venueStrings = [
    "country",
    "taxId",
    "legalName",
    "tillName",
    "seriesCode",
    "rectificativeSeriesCode",
  ];
  const locationStrings = [
    "id",
    "name",
    "operationDescription",
    "fiscalTerritory",
    "timeZone",
    "dayCutover",
    "orderFlow",
    "bumpMode",
    "fireControl",
    "receiptPrintMode",
    "drawerOpenPolicy",
  ];
  if (
    venueStrings.some((field) => typeof venue[field] !== "string") ||
    locationStrings.some((field) => typeof location[field] !== "string") ||
    !Array.isArray(location.invoiceLocales) ||
    location.invoiceLocales.length === 0 ||
    location.invoiceLocales.some((locale) => typeof locale !== "string") ||
    ["addressLine1", "addressLine2", "postalCode", "city", "province", "catalogueId"].some(
      (field) => location[field] !== null && typeof location[field] !== "string",
    )
  ) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  return value as unknown as ConfigurationBundle;
}

export function decodeConfigurationBundle(
  artifact: Uint8Array,
  passphrase: string,
): ConfigurationBundle {
  return decodeConfigurationArchive(artifact, passphrase).bundle;
}

/** Publish validated immutable media after the database import commits. Repeating this after a
 * restart writes the same bytes to the same content-addressed names. */
export async function publishConfigurationMedia(
  artifact: Uint8Array,
  passphrase: string,
  mediaDir: string,
): Promise<void> {
  const { media } = decodeConfigurationArchive(artifact, passphrase);
  await mkdir(mediaDir, { recursive: true });
  for (const entry of media) {
    const filename = entry.name.slice("media/".length);
    await writeFileAtomic(join(mediaDir, filename), entry.bytes, 0o644);
  }
}

function checkedRows(
  bundle: ConfigurationBundle,
  modules: readonly WaitronModule[],
): Array<readonly [ConfigurationTransferTable, Array<Record<string, unknown>>]> {
  const declared = declarations(modules);
  const expected = new Set(declared.map((table) => table.name));
  if (Object.keys(bundle.tables).some((name) => !expected.has(name))) {
    throw new AppError("setup.request_invalid", { field: "tables" });
  }
  return declared.map((table) => {
    const rows = bundle.tables[table.name];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_TABLE) {
      throw new AppError("setup.request_invalid", { field: `table:${table.name}` });
    }
    for (const row of rows) {
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        throw new AppError("setup.request_invalid", { field: `table:${table.name}` });
      }
      for (const omitted of table.omit ?? []) {
        if (omitted in row) {
          throw new AppError("setup.request_invalid", { field: `${table.name}.${omitted}` });
        }
      }
    }
    return [table, rows] as const;
  });
}

/** Reject tables, stripped fields and module versions that the target cannot import before setup
 * stages the artifact or starts a production venue transaction. */
export function validateConfigurationBundle(
  bundle: ConfigurationBundle,
  modules: readonly WaitronModule[],
  targetVersions: Readonly<Record<string, number>>,
): void {
  const expectedModules = new Set(modules.map((module) => module.name));
  if (Object.keys(bundle.modules).some((name) => !expectedModules.has(name))) {
    throw new AppError("setup.request_invalid", { field: "modules" });
  }
  for (const module of modules) {
    if (bundle.modules[module.name] !== targetVersions[module.name]) {
      throw new AppError("setup.request_invalid", { field: `module:${module.name}` });
    }
  }
  checkedRows(bundle, modules);
}

/** Apply the validated allowlist inside the caller's venue transaction. */
export async function importConfigurationTables(
  tx: Transaction,
  bundle: ConfigurationBundle,
  target: { tenantId: string; locationId: string },
  modules: readonly WaitronModule[],
  targetVersions: Readonly<Record<string, number>>,
): Promise<void> {
  validateConfigurationBundle(bundle, modules, targetVersions);
  const checked = checkedRows(bundle, modules);
  const columns = new Map<string, Set<string>>();
  for (const [declaration] of checked) {
    const result = await tx.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = ${declaration.name}
    `);
    const allowed = new Set(result.rows.map((row) => row.column_name));
    if (allowed.size === 0) {
      throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
    }
    columns.set(declaration.name, allowed);
  }
  for (const [declaration, rows] of checked) {
    const allowed = columns.get(declaration.name)!;
    for (const row of rows) {
      if (Object.keys(row).some((field) => !allowed.has(field))) {
        throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
      }
    }
  }

  for (const [declaration] of [...checked].reverse()) {
    if (declaration.name === "persons") {
      await tx.execute(sql`
        delete from ${sql.identifier(declaration.name)}
        where tenant_id = ${target.tenantId} and role <> 'admin'
      `);
    } else {
      await tx.execute(sql`
        delete from ${sql.identifier(declaration.name)} where tenant_id = ${target.tenantId}
      `);
    }
  }

  const sourceAdminIds = new Set(
    (bundle.tables.persons ?? [])
      .filter((row) => row.role === "admin")
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const idMap = new Map<string, string>([
    [bundle.sourceTenantId, target.tenantId],
    [bundle.venue.location.id, target.locationId],
  ]);
  for (const [, rows] of checked) {
    for (const row of rows) {
      if (typeof row.id === "string") idMap.set(row.id, randomUUID());
    }
  }
  for (const [declaration, rows] of checked) {
    for (const source of rows) {
      if (declaration.name === "persons" && source.role === "admin") continue;
      if (typeof source.person_id === "string" && sourceAdminIds.has(source.person_id)) continue;
      const row: Record<string, unknown> = { ...source, tenant_id: target.tenantId };
      for (const [field, value] of Object.entries(row)) {
        if (typeof value === "string" && idMap.has(value)) row[field] = idMap.get(value)!;
      }
      for (const column of declaration.locationColumns ?? []) {
        if (column in row) row[column] = target.locationId;
      }
      if (declaration.name === "persons") {
        row.pin_hash = `disabled-import:${randomUUID()}`;
        row.password_hash = null;
        row.totp_secret = null;
        row.email_verified_at = null;
        row.status = "suspended";
      }
      if (declaration.name === "print_agents") {
        row.token_hash = `disabled-import:${randomUUID()}`;
        row.active = false;
      }
      if (declaration.name === "printers") row.active = false;
      await tx.execute(sql`
        insert into ${sql.identifier(declaration.name)}
        select * from jsonb_populate_record(
          null::${sql.identifier(declaration.name)},
          ${JSON.stringify(row)}::jsonb
        )
      `);
    }
  }
  await applyPreparedLocation(tx, target, {
    ...bundle.venue.location,
    catalogueId:
      bundle.venue.location.catalogueId === null
        ? null
        : (idMap.get(bundle.venue.location.catalogueId) ?? bundle.venue.location.catalogueId),
  });
}
