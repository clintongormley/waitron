import {
  exportSettingsDocuments,
  checkImportedSettings,
  importSettingsDocuments,
  type TransferredSettings,
} from "./settings-transfer.js";
import { requireCountryTimeZone } from "@waitron/country-packs";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  AppError,
  businessDayAt,
  cutoverForBusinessDay,
  firstUnusedStationColour,
  isStationColour,
  PRIVACY_CONTACT_FIELDS,
} from "@waitron/shared";
import {
  readVenue,
  readVenueClock,
  venueLocationId,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  modulesWithSets,
  type ConfigurationTransferTable,
  type WaitronModule,
} from "@waitron/module";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import "./errors.js";
import { assertImportedStationTimings } from "./kitchen-timing.js";
import {
  privacyContactChecked,
  savePrivacyContact,
  type PrivacyContact,
} from "./privacy-contact.js";

const ENTRY = "configuration.json";

const MAX_ROWS_PER_TABLE = 100_000;

export interface PreparedVenue {
  country: string;
  taxId: string;
  legalName: string;
  taxpayerDomicile: string | null;
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
  seriesCode: string;
  fullSeriesCode: string;
  rectificativeSeriesCode: string;
}

export async function buildConfigurationBundle(
  db: Database | Transaction,
  source: {
    nodeId: string;
    sourceOperatorId?: string;
  },
  modules: readonly WaitronModule[],
  now: Date,
  moduleVersions: Record<string, number>,
): Promise<ConfigurationBundle> {
  const taxpayer = await db.execute<{
    country: string;
    taxId: string;
    legalName: string;
    taxpayerDomicile: string | null;
    privacyNoticeUrl: string | null;
    privacyEmail: string | null;
    seriesCode: string | null;
    fullSeriesCode: string | null;
    rectificativeSeriesCode: string | null;
  }>(sql`
    select
      t.country, t.tax_id as "taxId", t.legal_name as "legalName",
      t.taxpayer_domicile as "taxpayerDomicile",
      t.privacy_notice_url as "privacyNoticeUrl", t.privacy_email as "privacyEmail",
      max(s.code) filter (where s.purpose = 'standard') as "seriesCode",
      max(s.code) filter (where s.purpose = 'full') as "fullSeriesCode",
      max(s.code) filter (where s.purpose = 'rectificative') as "rectificativeSeriesCode"
    from tenants t
    join nodes n on n.id = ${source.nodeId}
    join invoice_series s on s.node_id = n.id and s.retired_at is null
    group by t.id
  `);
  const row = taxpayer.rows[0];
  if (
    row === undefined ||
    row.seriesCode === null ||
    row.fullSeriesCode === null ||
    row.rectificativeSeriesCode === null
  ) {
    throw new AppError("setup.request_invalid", { field: "venue" });
  }
  const {
    country,
    taxId,
    legalName,
    taxpayerDomicile,
    privacyNoticeUrl,
    privacyEmail,
    seriesCode,
    fullSeriesCode,
    rectificativeSeriesCode,
  } = row;
  const { defaultCatalogueId, ...fields } = await readVenue(db);
  // The column's JSON read mapping checks no element types.
  if (fields.invoiceLocales.some((locale: unknown) => typeof locale !== "string")) {
    throw new AppError("setup.request_invalid", { field: "venue" });
  }
  const clock = await readVenueClock(db);
  const businessDay = businessDayAt(clock, now);
  if (clock.cutoverChanges.some((change) => change.effectiveBusinessDay > businessDay))
    throw new AppError("setup.request_invalid", { field: "businessDayStart" });
  const transferred = await exportConfigurationTables(db, modules);
  return {
    version: 14,
    createdAt: now.toISOString(),
    sourceOperatorId: source.sourceOperatorId ?? "",
    venue: {
      country,
      taxId,
      legalName,
      taxpayerDomicile,
      ...fields,
      dayCutover: `${cutoverForBusinessDay(clock, businessDay)}:00`,
      seriesCode,
      fullSeriesCode,
      rectificativeSeriesCode,
    },
    defaultCatalogueId,
    privacyContact: { privacyNoticeUrl, privacyEmail },
    settings: await exportSettingsDocuments(db, modules),
    // A trading box's versions also name its switched-off modules, which setup refuses.
    modules: Object.fromEntries(
      Object.entries(moduleVersions).filter(([name]) =>
        modulesWithSets(modules).some((module) => module.name === name),
      ),
    ),
    ...transferred,
  };
}

export async function applyPreparedVenue(
  tx: Transaction,
  venue: { defaultCatalogueId: string | null },
): Promise<void> {
  await tx.execute(sql`
    update locations set catalogue_id = ${venue.defaultCatalogueId}
    where id = ${await venueLocationId(tx)}
  `);
}

export interface ConfigurationBundle {
  version: 14;
  settings: Record<string, TransferredSettings>;
  createdAt: string;
  sourceOperatorId: string;
  venue: PreparedVenue;
  defaultCatalogueId: string | null;
  privacyContact: PrivacyContact;
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
  const ordered: ConfigurationTransferTable[] = [];
  const visiting = new Set<string>();
  const emitted = new Set<string>();
  for (const table of tables)
    for (const name of table.before ?? []) {
      if (!names.has(name)) throw new AppError("setup.request_invalid", { field: `table:${name}` });
    }
  const emit = (table: ConfigurationTransferTable): void => {
    if (emitted.has(table.name)) return;
    if (visiting.has(table.name))
      throw new AppError("setup.request_invalid", { field: `table:${table.name}` });
    visiting.add(table.name);
    for (const dependency of tables.filter((candidate) => candidate.before?.includes(table.name)))
      emit(dependency);
    visiting.delete(table.name);
    emitted.add(table.name);
    ordered.push(table);
  };
  tables.forEach(emit);
  return ordered;
}

/**
 * A BLOB is read back as a `Uint8Array`, which `JSON.stringify` renders as an object keyed by
 * index, so it travels as `\x<hex>`. The spelling is not ours to choose:
 * `packages/media/src/configuration-transfer.ts` refuses an image's bytes in any other encoding.
 */
function encodeBytes(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

/** This engine refuses to bind a JS boolean; a boolean column holds 0 or 1. */
function bindable(value: unknown): unknown {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

/** The other half of {@link encodeBytes}, applied only to a column the SCHEMA declares `blob`.
 * Matching on the value's shape instead would rewrite any ordinary text column whose contents
 * happen to start with a backslash and an x. */
function decodeBytes(value: unknown): unknown {
  return typeof value === "string" && /^\\x(?:[a-fA-F0-9]{2})*$/.test(value)
    ? Buffer.from(value.slice(2), "hex")
    : value;
}

const ROWID = "__export_rowid";

/** The engine matches table and column names ignoring ASCII case only, so `toLowerCase`, which also
 * folds some other letters into ASCII ones, would match names the engine keeps apart. Declared
 * table names are lowercase ASCII. */
function asciiLower(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function mapJsonPath(
  value: unknown,
  path: readonly string[],
  map: (id: string) => string | undefined,
  field: string,
  wildcardSelected = false,
): unknown {
  if (value === null) return null;
  if (path.length === 0) {
    if (typeof value !== "string") throw new AppError("setup.request_invalid", { field });
    return map(value);
  }
  if (typeof value !== "object") {
    if (wildcardSelected) return value;
    throw new AppError("setup.request_invalid", { field });
  }
  const [step, ...rest] = path;
  if (Array.isArray(value)) {
    if (step !== "*") throw new AppError("setup.request_invalid", { field });
    return value
      .map((item) => mapJsonPath(item, rest, map, field, true))
      .filter((item) => item !== undefined);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      step === "*" || step === key
        ? (mapJsonPath(item, rest, map, field, step === "*") ?? null)
        : item,
    ]),
  );
}

function rewriteJsonReferences(
  row: Record<string, unknown>,
  declaration: ConfigurationTransferTable,
  map: (id: string, field: string) => string | undefined,
): void {
  for (const reference of declaration.jsonReferences ?? []) {
    const field = `${declaration.name}.${reference.column}`;
    const source = row[reference.column];
    if (source === null) continue;
    if (typeof source !== "string") throw new AppError("setup.request_invalid", { field });
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw new AppError("setup.request_invalid", { field });
    }
    for (const path of reference.paths)
      value = mapJsonPath(value, path, (id) => map(id, field), field);
    row[reference.column] = JSON.stringify(value);
  }
}

/** Read the explicitly declared configuration tables (one tenant per database), less the rows a
 * table's leave-behind selector excludes and every row whose foreign key names one of them. */
export async function exportConfigurationTables(
  db: Database | Transaction,
  modules: readonly WaitronModule[],
): Promise<{ tables: ConfigurationBundle["tables"]; reconnect: string[] }> {
  const declared = declarations(modules);
  const { tracked, keys } = await reachedForeignKeys(db, declared);
  if (tracked.size > 0) await refuseWithoutRowid(db, tracked);

  const read = new Map<string, Array<Record<string, unknown>>>();
  const leftBehind = new Map<string, Set<unknown>>();
  for (const declaration of declared) {
    const isTracked = tracked.has(declaration.name);
    const selectorColumns = [
      declaration.leaveBehindWhenSet,
      declaration.leaveBehindWhenFalse,
    ].filter((column): column is string => column !== undefined);
    if (isTracked) {
      // `table_info` leaves out generated columns, which `select *` returns and which can be named
      // `rowid`.
      const columns = await db.execute<{ name: string }>(sql`
        select name from pragma_table_xinfo(${declaration.name})
      `);
      const names = new Set(columns.rows.map((row) => row.name));
      // A declared selector must address an actual column; undefined cannot decide whether a row travels.
      for (const column of selectorColumns) {
        if (!names.has(column))
          throw new AppError("setup.request_invalid", { field: `${declaration.name}.${column}` });
      }
      // A column named `rowid`, in any case, hides the engine's own from every query below; the
      // alias is a key of the row object, so only its exact spelling collides.
      const shadowed = [...names].find((name) => name === ROWID || asciiLower(name) === "rowid");
      if (shadowed !== undefined) {
        throw new AppError("setup.request_invalid", { field: `${declaration.name}.${shadowed}` });
      }
    }
    const result = await db.execute<Record<string, unknown>>(
      isTracked
        ? sql`select rowid as ${sql.identifier(ROWID)}, * from ${sql.identifier(declaration.name)}`
        : sql`select * from ${sql.identifier(declaration.name)}`,
    );
    if (result.rows.length > MAX_ROWS_PER_TABLE) {
      throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
    }
    read.set(declaration.name, result.rows);
    leftBehind.set(
      declaration.name,
      new Set(
        result.rows
          .filter(
            (row) =>
              (declaration.leaveBehindWhenSet !== undefined &&
                row[declaration.leaveBehindWhenSet] !== null) ||
              (declaration.leaveBehindWhenFalse !== undefined &&
                (row[declaration.leaveBehindWhenFalse] === 0 ||
                  row[declaration.leaveBehindWhenFalse] === false)),
          )
          .map((row) => row[ROWID]),
      ),
    );
  }
  await leaveBehindReferences(db, keys, leftBehind);

  const tables: ConfigurationBundle["tables"] = {};
  const reconnect: string[] = [];
  const exportedIds = new Set<string>();
  for (const declaration of declared) {
    for (const row of read.get(declaration.name)!) {
      if (!leftBehind.get(declaration.name)!.has(row[ROWID]) && typeof row.id === "string")
        exportedIds.add(row.id);
    }
  }
  for (const declaration of declared) {
    const gone = leftBehind.get(declaration.name)!;
    const rows = read.get(declaration.name)!.filter((row) => !gone.has(row[ROWID]));
    tables[declaration.name] = rows.map((row) => {
      const copy = { ...row };
      if (tracked.has(declaration.name)) delete copy[ROWID];
      for (const field of declaration.omit ?? []) delete copy[field];
      rewriteJsonReferences(copy, declaration, (id) => (exportedIds.has(id) ? id : undefined));
      for (const [field, value] of Object.entries(copy)) {
        if (value instanceof Uint8Array) copy[field] = encodeBytes(value);
      }
      return copy;
    });
    if (declaration.reconnect && rows.length > 0) reconnect.push(declaration.name);
  }
  return { tables, reconnect };
}

interface ForeignKey {
  table: string;
  parent: string;
  from: string[];
  to: string[];
}

/** The tables a row left behind can reach through foreign keys between declared tables, from a
 * table that declares a leave-behind selector to its children and theirs, and the keys that lead there,
 * their parent columns resolved: a key that names none references the parent's primary key, in the
 * primary key's own column order. */
async function reachedForeignKeys(
  db: Database | Transaction,
  declared: readonly ConfigurationTransferTable[],
): Promise<{ tracked: Set<string>; keys: ForeignKey[] }> {
  const tracked = new Set(
    declared
      .filter(
        (declaration) =>
          declaration.leaveBehindWhenSet !== undefined ||
          declaration.leaveBehindWhenFalse !== undefined,
      )
      .map((declaration) => declaration.name),
  );
  if (tracked.size === 0) return { tracked, keys: [] };
  const names = new Set(declared.map((declaration) => declaration.name));
  const found: Array<{ table: string; parent: string; from: string[]; to: Array<string | null> }> =
    [];
  for (const declaration of declared) {
    const result = await db.execute<{ id: number; table: string; from: string; to: string | null }>(
      sql`
        select id, "table", "from", "to" from pragma_foreign_key_list(${declaration.name})
        order by id, seq
      `,
    );
    const byId = new Map<number, (typeof found)[number]>();
    for (const row of result.rows) {
      const key = byId.get(row.id) ?? {
        table: declaration.name,
        parent: asciiLower(row.table),
        from: [],
        to: [],
      };
      key.from.push(row.from);
      key.to.push(row.to);
      byId.set(row.id, key);
    }
    found.push(...[...byId.values()].filter((key) => names.has(key.parent)));
  }
  const reached = new Set<(typeof found)[number]>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const key of found) {
      if (reached.has(key) || !tracked.has(key.parent)) continue;
      reached.add(key);
      tracked.add(key.table);
      grew = true;
    }
  }
  const keys: ForeignKey[] = [];
  for (const key of reached) {
    let to = key.to;
    if (to.some((column) => column === null)) {
      const primary = await db.execute<{ name: string }>(sql`
        select name from pragma_table_info(${key.parent}) where pk > 0 order by pk
      `);
      to = primary.rows.map((row) => row.name);
    }
    if (to.length !== key.from.length) {
      throw new AppError("setup.request_invalid", { field: `table:${key.table}` });
    }
    keys.push({ ...key, to: to as string[] });
  }
  return { tracked, keys };
}

async function refuseWithoutRowid(db: Database | Transaction, tables: Set<string>): Promise<void> {
  const result = await db.execute<{ name: string }>(sql`
    select name from pragma_table_list where schema = 'main' and wr = 1
  `);
  for (const row of result.rows) {
    const name = asciiLower(row.name);
    if (tables.has(name)) throw new AppError("setup.request_invalid", { field: `table:${name}` });
  }
}

/**
 * Adds to `leftBehind` every row whose foreign key names a left-behind row, repeating until nothing
 * more is added, so no exported row's foreign key names a row left behind. The `references` lists
 * are not read.
 *
 * The engine pairs the rows: `parent = +child` takes the parent column's collation (the left
 * column wins) and its affinity (the `+` strips the child's), as a foreign key compares, and a null
 * in either side matches nothing, as a key with a null in it references nothing.
 */
async function leaveBehindReferences(
  db: Database | Transaction,
  keys: readonly ForeignKey[],
  leftBehind: Map<string, Set<unknown>>,
): Promise<void> {
  if ([...leftBehind.values()].every((rows) => rows.size === 0)) return;
  const pairs: Array<{ key: ForeignKey; rows: Array<{ child: unknown; parent: unknown }> }> = [];
  for (const key of keys) {
    const on = sql.join(
      key.from.map(
        (from, index) => sql`p.${sql.identifier(key.to[index]!)} = +c.${sql.identifier(from)}`,
      ),
      sql` and `,
    );
    const result = await db.execute<{ child: unknown; parent: unknown }>(sql`
      select c.rowid as child, p.rowid as parent
      from ${sql.identifier(key.table)} as c join ${sql.identifier(key.parent)} as p on ${on}
    `);
    pairs.push({ key, rows: result.rows });
  }
  let moved = true;
  while (moved) {
    moved = false;
    for (const { key, rows } of pairs) {
      const gone = leftBehind.get(key.parent)!;
      const leaving = leftBehind.get(key.table)!;
      for (const row of rows) {
        if (gone.has(row.parent) && !leaving.has(row.child)) {
          leaving.add(row.child);
          moved = true;
        }
      }
    }
  }
}

export function encodeConfigurationBundle(bundle: ConfigurationBundle, passphrase: string): Buffer {
  if (passphrase.length < 12) throw new AppError("setup.request_invalid", { field: "passphrase" });
  return encryptArtifact(
    packArchive([{ name: ENTRY, bytes: Buffer.from(JSON.stringify(bundle), "utf8") }]),
    passphrase,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfigurationBundle(value: unknown): ConfigurationBundle {
  if (!isRecord(value)) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  if (typeof value.version === "number" && value.version > 14) {
    throw new AppError("setup.configuration_newer", {});
  }
  if (value.version !== 14) throw new AppError("setup.configuration_outdated", {});
  const venue = value.venue;
  const modules = value.modules;
  const tables = value.tables;
  if (
    typeof value.createdAt !== "string" ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.sourceOperatorId !== "string" ||
    !isRecord(venue) ||
    (value.defaultCatalogueId !== null && typeof value.defaultCatalogueId !== "string") ||
    !isRecord(modules) ||
    Object.values(modules).some((version) => !Number.isInteger(version) || Number(version) < 0) ||
    !isRecord(tables) ||
    !isRecord(value.settings) ||
    Object.values(value.settings).some(
      (entry) =>
        !isRecord(entry) ||
        !Number.isInteger(entry.version) ||
        Number(entry.version) < 1 ||
        !isRecord(entry.doc),
    ) ||
    !Array.isArray(value.reconnect) ||
    value.reconnect.some((name) => typeof name !== "string")
  ) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  const venueStrings = [
    "country",
    "taxId",
    "legalName",
    "seriesCode",
    "fullSeriesCode",
    "rectificativeSeriesCode",
    "name",
    "operationDescription",
    "fiscalTerritory",
    "dayCutover",
  ];
  if (
    venueStrings.some((field) => typeof venue[field] !== "string") ||
    !Array.isArray(venue.invoiceLocales) ||
    venue.invoiceLocales.length === 0 ||
    venue.invoiceLocales.some((locale) => typeof locale !== "string") ||
    ["taxpayerDomicile", "addressLine1", "addressLine2", "postalCode", "city", "province"].some(
      (field) => venue[field] !== null && typeof venue[field] !== "string",
    )
  ) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  const privacyContact = value.privacyContact;
  if (
    !isRecord(privacyContact) ||
    PRIVACY_CONTACT_FIELDS.some(
      (field) => privacyContact[field] !== null && typeof privacyContact[field] !== "string",
    )
  ) {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  requireCountryTimeZone(venue.country as string, venue.timeZone);
  return value as unknown as ConfigurationBundle;
}

export function decodeConfigurationBundle(
  artifact: Uint8Array,
  passphrase: string,
): ConfigurationBundle {
  const entries = unpackArchive(decryptArtifact(artifact, passphrase));
  if (entries.length !== 1 || entries[0]?.name !== ENTRY)
    throw new AppError("setup.request_invalid", { field: "artifact" });
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(entries[0].bytes).toString("utf8"));
  } catch {
    throw new AppError("setup.request_invalid", { field: "artifact" });
  }
  return parseConfigurationBundle(value);
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
  const timeZone = requireCountryTimeZone(bundle.venue.country, bundle.venue.timeZone);
  const versioned = modulesWithSets(modules);
  const serverSets = new Set(versioned.map((module) => module.name));
  const exportSets = new Set(Object.keys(bundle.modules));
  const exportOnly = [...exportSets].filter((name) => !serverSets.has(name)).sort();
  const serverOnly = [...serverSets].filter((name) => !exportSets.has(name)).sort();
  if (exportOnly.length > 0 || serverOnly.length > 0) {
    throw new AppError("setup.configuration_parts_differ", { exportOnly, serverOnly });
  }
  const unrecorded = versioned.find((module) => targetVersions[module.name] === undefined);
  if (unrecorded !== undefined) {
    throw new AppError("setup.request_invalid", { field: `module:${unrecorded.name}` });
  }
  const differences = versioned.map(
    (module) => bundle.modules[module.name]! - targetVersions[module.name]!,
  );
  if (differences.some((difference) => difference > 0)) {
    throw new AppError("setup.configuration_newer", {});
  }
  if (differences.some((difference) => difference < 0)) {
    throw new AppError("setup.configuration_outdated", {});
  }
  checkImportedSettings(bundle.settings, modules);
  checkedRows(bundle, modules);
  for (const field of PRIVACY_CONTACT_FIELDS) {
    const value = bundle.privacyContact[field];
    if (typeof value === "string") privacyContactChecked(field, value);
  }
  const exported = {
    createdAt: new Date(bundle.createdAt),
    timeZone,
    dayCutover: bundle.venue.dayCutover.slice(0, 5),
    country: bundle.venue.country,
    area: bundle.venue.province,
  };
  for (const module of modules) {
    const contribution = module.configurationTransfer;
    if (contribution?.kind === "tables") contribution.validate?.(bundle.tables, exported);
  }
}

/** Apply the validated allowlist inside the caller's venue transaction. */
export async function importConfigurationTables(
  tx: Transaction,
  bundle: ConfigurationBundle,
  modules: readonly WaitronModule[],
  targetVersions: Readonly<Record<string, number>>,
): Promise<void> {
  validateConfigurationBundle(bundle, modules, targetVersions);
  for (const module of modules) {
    const contribution = module.configurationTransfer;
    if (contribution?.kind === "tables") await contribution.beforeImport?.(tx, bundle.tables);
  }
  const incoming = checkedRows(bundle, modules);
  const incomingStations =
    incoming.find(([declaration]) => declaration.name === "kitchen_stations")?.[1] ?? [];
  assertImportedStationTimings(incomingStations);
  const stationColours = new Set(incomingStations.map((row) => row.colour).filter(isStationColour));
  const checked = incoming.map(
    ([declaration, rows]) =>
      [
        declaration,
        declaration.name === "kitchen_stations"
          ? rows.map((row) => {
              if (row.colour !== undefined) return row;
              const colour = firstUnusedStationColour(stationColours);
              stationColours.add(colour);
              return { ...row, colour };
            })
          : rows,
      ] as const,
  );
  const columns = new Map<string, Set<string>>();
  // Which columns hold bytes, so the bundle's `\x<hex>` strings go back in as BYTES: a string bound
  // to a BLOB column is stored as text.
  const blobColumns = new Map<string, Set<string>>();
  // A name or other text may equal a bundle id, so only these columns are rewritten to new ids.
  const idColumns = new Map<string, Set<string>>();
  // Every foreign key into `locations` is filled with the importing venue's one row, whatever the
  // bundle says.
  const venueColumns = new Map<string, string[]>();
  for (const [declaration] of checked) {
    // The table-valued `pragma_table_info(?)` binds its argument, unlike the `pragma table_info`
    // statement. An unknown table yields no rows, which the empty check below refuses.
    const result = await tx.execute<{ column_name: string; column_type: string }>(sql`
      select name as column_name, type as column_type from pragma_table_info(${declaration.name})
    `);
    const allowed = new Set(result.rows.map((row) => row.column_name));
    if (allowed.size === 0) {
      throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
    }
    columns.set(declaration.name, allowed);
    blobColumns.set(
      declaration.name,
      new Set(
        result.rows
          .filter((row) => row.column_type.toUpperCase().includes("BLOB"))
          .map((row) => row.column_name),
      ),
    );
    const keys = await tx.execute<{ from: string; table: string }>(sql`
      select "from", "table" from pragma_foreign_key_list(${declaration.name})
    `);
    idColumns.set(
      declaration.name,
      new Set(["id", ...keys.rows.map((row) => row.from), ...(declaration.references ?? [])]),
    );
    venueColumns.set(
      declaration.name,
      keys.rows.filter((row) => row.table === "locations").map((row) => row.from),
    );
  }
  for (const [declaration, rows] of checked) {
    const allowed = columns.get(declaration.name)!;
    for (const row of rows) {
      if (Object.keys(row).some((field) => !allowed.has(field))) {
        throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
      }
    }
  }

  // A fresh venue's default menu is the initial catalogue created by catalogue provisioning. The
  // imported catalogue set replaces that seed, so release the foreign key before deletion; the
  // remapped source default is restored by applyPreparedVenue after the rows are inserted.
  const venueId = await venueLocationId(tx);
  await applyPreparedVenue(tx, { defaultCatalogueId: null });

  // Moves the key checks to COMMIT, for this transaction only; the caller's commit still checks the
  // final state.
  // `packages/db/src/testing/venue-db.ts` empties a whole venue the same way.
  await tx.execute(sql`pragma defer_foreign_keys = on`);
  for (const [declaration] of [...checked].reverse()) {
    if (declaration.name === "persons") {
      await tx.execute(sql`
        delete from ${sql.identifier(declaration.name)}
        where role <> 'admin'
      `);
    } else {
      await tx.execute(sql`
        delete from ${sql.identifier(declaration.name)}
      `);
    }
  }

  const sourceOperatorIds = new Set(
    bundle.sourceOperatorId === "" ? [] : [bundle.sourceOperatorId],
  );
  const idMap = new Map<string, string>();
  const jsonIdMap = new Map<string, string>();
  for (const [declaration, rows] of checked) {
    for (const row of rows) {
      if (typeof row.id === "string") {
        const mapped = randomUUID();
        idMap.set(row.id, mapped);
        if (declaration.name === "persons" && row.id === bundle.sourceOperatorId) continue;
        if (typeof row.person_id === "string" && sourceOperatorIds.has(row.person_id)) continue;
        jsonIdMap.set(row.id, mapped);
      }
    }
  }
  for (const [declaration, rows] of checked) {
    for (const source of rows) {
      if (declaration.name === "persons" && source.id === bundle.sourceOperatorId) continue;
      if (typeof source.person_id === "string" && sourceOperatorIds.has(source.person_id)) continue;
      const row: Record<string, unknown> = { ...source };
      rewriteJsonReferences(row, declaration, (id, field) => {
        const mapped = jsonIdMap.get(id);
        if (mapped === undefined) throw new AppError("setup.request_invalid", { field });
        return mapped;
      });
      const blobs = blobColumns.get(declaration.name)!;
      const ids = idColumns.get(declaration.name)!;
      for (const [field, value] of Object.entries(row)) {
        if (ids.has(field) && typeof value === "string" && idMap.has(value))
          row[field] = idMap.get(value)!;
        else if (blobs.has(field)) row[field] = decodeBytes(value);
      }
      for (const column of venueColumns.get(declaration.name)!) {
        if (column in row) row[column] = venueId;
      }
      if (declaration.name === "persons") {
        row.pin_hash = `disabled-import:${randomUUID()}`;
        row.password_hash = null;
        row.totp_secret = null;
        row.email_verified_at = null;
        row.google_subject = null;
        row.pending_email = null;
        row.status = "suspended";
      }
      if (declaration.name === "print_agents") {
        row.token_hash = `disabled-import:${randomUUID()}`;
        row.active = false;
      }
      if (declaration.name === "printers" || declaration.name === "page_printers")
        row.active = false;
      if (declaration.name === "page_printers") row.agent_id = null;
      // Every key was checked against `pragma_table_info` above, so `sql.identifier` names a real
      // column of a real table; the values bind.
      const fields = Object.keys(row);
      await tx.execute(sql`
        insert into ${sql.identifier(declaration.name)}
        (${sql.join(
          fields.map((field) => sql.identifier(field)),
          sql`, `,
        )})
        values (${sql.join(
          fields.map((field) => sql`${bindable(row[field])}`),
          sql`, `,
        )})
      `);
    }
  }
  await applyPreparedVenue(tx, {
    defaultCatalogueId:
      bundle.defaultCatalogueId === null
        ? null
        : (idMap.get(bundle.defaultCatalogueId) ?? bundle.defaultCatalogueId),
  });
  const { privacyNoticeUrl, privacyEmail } = bundle.privacyContact;
  await savePrivacyContact(tx, {
    privacyNoticeUrl:
      privacyNoticeUrl === null
        ? null
        : privacyContactChecked("privacyNoticeUrl", privacyNoticeUrl),
    privacyEmail:
      privacyEmail === null ? null : privacyContactChecked("privacyEmail", privacyEmail),
  });
  await importSettingsDocuments(tx, bundle.settings, modules);
  for (const module of modules) {
    const contribution = module.configurationTransfer;
    if (contribution?.kind === "tables") await contribution.afterImport?.(tx);
  }
}
