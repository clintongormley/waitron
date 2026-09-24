import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { Database, Transaction } from "@waitron/db";
import type { ConfigurationTransferTable, WaitronModule } from "@waitron/module";
import { decryptArtifact, encryptArtifact } from "./artifact-cipher.js";
import { packArchive, unpackArchive } from "./backup-archive.js";
import "./errors.js";

const ENTRY = "configuration.json";

/**
 * A location's `invoice_locales` as read by RAW SQL — the JSON text the column stores.
 *
 * The column is a JSON list on this engine and a raw select bypasses its read mapping, so the value
 * arrives as `["es"]` rather than as `["es"]` the array. Anything else is an artifact this code did
 * not write, and is refused rather than guessed at.
 */
function parseLocaleList(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError("setup.request_invalid", { field: "venue" });
  }
  if (!Array.isArray(parsed) || parsed.some((locale) => typeof locale !== "string")) {
    throw new AppError("setup.request_invalid", { field: "venue" });
  }
  return parsed as string[];
}
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
  source: {
    locationId: string;
    tillId: string;
    nodeId: string;
    sourceOperatorId?: string;
  },
  modules: readonly WaitronModule[],
  now: Date,
  moduleVersions: Record<string, number>,
): Promise<ConfigurationBundle> {
  const venue = await db.execute<
    Omit<PreparedVenue["location"], "invoiceLocales"> & {
      // A raw read never reaches a column's read mapping, so this arrives as the JSON TEXT the
      // column stores rather than as the list. Parsed below.
      invoiceLocales: string;
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
      l.day_cutover as "dayCutover", l.order_flow as "orderFlow", l.bump_mode as "bumpMode",
      l.fire_control as "fireControl", l.receipt_print_mode as "receiptPrintMode",
      l.drawer_open_policy as "drawerOpenPolicy", l.catalogue_id as "catalogueId",
      till.name as "tillName",
      max(s.code) filter (where s.purpose = 'standard') as "seriesCode",
      max(s.code) filter (where s.purpose = 'rectificative') as "rectificativeSeriesCode"
    from tenants t
    join locations l on l.id = ${source.locationId}
    join tills till on till.id = ${source.tillId}
    join nodes n on n.id = ${source.nodeId}
    join invoice_series s on s.node_id = n.id and s.retired_at is null
    group by t.id, l.id, till.id
  `);
  const row = venue.rows[0];
  if (row === undefined || row.seriesCode === null || row.rectificativeSeriesCode === null) {
    throw new AppError("setup.request_invalid", { field: "venue" });
  }
  const {
    country,
    taxId,
    legalName,
    tillName,
    seriesCode,
    rectificativeSeriesCode,
    invoiceLocales,
    ...rest
  } = row;
  // `day_cutover` lost its `::text` cast in the select above: the column is TEXT on this engine, so
  // the cast is both unnecessary and a syntax error here (`unrecognized token: ":"`) — the same
  // change, for the same reason, as `packages/provisioning/src/venue-apply.ts`.
  const location = { ...rest, invoiceLocales: parseLocaleList(invoiceLocales) };
  const transferred = await exportConfigurationTables(db, modules);
  return {
    version: 1,
    createdAt: now.toISOString(),
    sourceOperatorId: source.sourceOperatorId ?? "",
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
  target: { locationId: string },
  location: PreparedVenue["location"],
): Promise<void> {
  // The column holds a JSON list as TEXT, checked by `locations_invoice_locales_len`
  // (`json_array_length(...) between 1 and 2`). A raw write never reaches the column's own encoder,
  // so the list is serialised here; the PostgreSQL `array[...]::text[]` constructor it replaces has
  // no equivalent on this engine.
  const invoiceLocales = JSON.stringify(location.invoiceLocales);
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
    where id = ${target.locationId}
  `);
}

export interface ConfigurationBundle {
  version: 1;
  createdAt: string;
  sourceOperatorId: string;
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
 * The bundle is JSON, and this engine hands a BLOB column back as a `Uint8Array`, which
 * `JSON.stringify` renders as an object keyed by index — bytes that no importer can read back.
 * So a BLOB travels as the `\x<hex>` spelling PostgreSQL's driver used to produce.
 *
 * **The spelling is not ours to choose.** `packages/media/src/configuration-transfer.ts` validates
 * every image's bytes against `/^\\x(?:[a-fA-F0-9]{2})+$/` before any configuration is written, and
 * it hashes what it decodes to check the filename. A bundle carrying an image in any other
 * encoding is refused with `image.invalid_metadata` — which is what the whole database path did on
 * this branch until this pair existed.
 */
function encodeBytes(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

/**
 * What this engine will bind. It refuses a JS boolean outright — `TypeError: Provided value cannot
 * be bound to SQLite parameter 5`, measured on the `print_agents.active` flag this function sets
 * below — and a boolean column holds 0 or 1, which is what every row that came OUT of a venue
 * already carries. So the conversion is here, at the bind, rather than at each of the three places
 * that overwrite a flag: a value read from a bundle never needs it, and one written here always
 * does.
 */
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

/** Read every row of the explicitly declared configuration tables (one tenant per database). */
export async function exportConfigurationTables(
  db: Database | Transaction,
  modules: readonly WaitronModule[],
): Promise<{ tables: ConfigurationBundle["tables"]; reconnect: string[] }> {
  const tables: ConfigurationBundle["tables"] = {};
  const reconnect: string[] = [];
  for (const declaration of declarations(modules)) {
    // `select *`, not PostgreSQL's `to_jsonb(t)`: this engine has no such function, and a raw read
    // already hands back one plain object per row. The values are the driver's — a JSON column
    // arrives as its TEXT and a flag as 0 or 1 — and `importConfigurationTables` writes those same
    // values straight back, so the round trip carries the stored bytes rather than a re-rendering
    // of them.
    const result = await db.execute<Record<string, unknown>>(sql`
      select * from ${sql.identifier(declaration.name)}
    `);
    if (result.rows.length > MAX_ROWS_PER_TABLE) {
      throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
    }
    tables[declaration.name] = result.rows.map((row) => {
      const copy = { ...row };
      for (const field of declaration.omit ?? []) delete copy[field];
      for (const [field, value] of Object.entries(copy)) {
        if (value instanceof Uint8Array) copy[field] = encodeBytes(value);
      }
      return copy;
    });
    if (declaration.reconnect && result.rows.length > 0) reconnect.push(declaration.name);
  }
  return { tables, reconnect };
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
    typeof value.sourceOperatorId !== "string" ||
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
  for (const module of modules) {
    const contribution = module.configurationTransfer;
    if (contribution?.kind === "tables") contribution.validate?.(bundle.tables);
  }
}

/** Apply the validated allowlist inside the caller's venue transaction. */
export async function importConfigurationTables(
  tx: Transaction,
  bundle: ConfigurationBundle,
  target: { locationId: string },
  modules: readonly WaitronModule[],
  targetVersions: Readonly<Record<string, number>>,
): Promise<void> {
  validateConfigurationBundle(bundle, modules, targetVersions);
  const checked = checkedRows(bundle, modules);
  const columns = new Map<string, Set<string>>();
  // Which columns hold bytes, so the bundle's `\x<hex>` strings go back in as BYTES. Written as
  // text instead they would be stored as text — this engine keeps whatever it is given, whatever a
  // column declares — and every later read of that image would hand back the hex.
  const blobColumns = new Map<string, Set<string>>();
  for (const [declaration] of checked) {
    // This engine has no `information_schema`; a table's columns come from the PRAGMA function.
    // The table-valued `pragma_table_info(?)` BINDS its argument — measured 2026-09-22 on Node
    // v26.7.0 against `node:sqlite`, with a literal-argument control returning the same two rows
    // and an unknown name returning none. That is not the same call as the `pragma table_info(?)`
    // STATEMENT, which is refused at prepare with `near "?": syntax error`
    // (`packages/db/src/deployment.ts` records that one). An unknown table yields no rows, which
    // the empty check below already treats as a refusal.
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
  }
  for (const [declaration, rows] of checked) {
    const allowed = columns.get(declaration.name)!;
    for (const row of rows) {
      if (Object.keys(row).some((field) => !allowed.has(field))) {
        throw new AppError("setup.request_invalid", { field: `table:${declaration.name}` });
      }
    }
  }

  // A fresh venue points its location at the initial catalogue created by catalogue provisioning.
  // The imported catalogue set replaces that seed, so release the foreign key before deletion; the
  // remapped source default is restored by applyPreparedLocation after the rows are inserted.
  await tx.execute(sql`
    update locations set catalogue_id = null
    where id = ${target.locationId}
  `);

  // The declared tables hold at least one FK CYCLE — `zone_menus.zone_id` points at
  // `zone_service_policies`, whose `(zone_id, default_menu_id)` points back at `zone_menus` — so no
  // delete order satisfies a per-statement check, and this engine refused the `zone_menus` delete
  // with `FOREIGN KEY constraint failed` (measured on this branch, with the pragma removed as the
  // control). The pragma moves the check to COMMIT, where every table in the cycle is already
  // empty; it holds only until this transaction ends, and the caller's commit still validates the
  // final state. `packages/db/src/testing/venue-db.ts` empties a whole venue the same way and
  // carries the mechanism.
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
  const idMap = new Map<string, string>([[bundle.venue.location.id, target.locationId]]);
  for (const [, rows] of checked) {
    for (const row of rows) {
      if (typeof row.id === "string") idMap.set(row.id, randomUUID());
    }
  }
  for (const [declaration, rows] of checked) {
    for (const source of rows) {
      if (declaration.name === "persons" && source.id === bundle.sourceOperatorId) continue;
      if (typeof source.person_id === "string" && sourceOperatorIds.has(source.person_id)) continue;
      const row: Record<string, unknown> = { ...source };
      const blobs = blobColumns.get(declaration.name)!;
      for (const [field, value] of Object.entries(row)) {
        if (typeof value === "string" && idMap.has(value)) row[field] = idMap.get(value)!;
        else if (blobs.has(field)) row[field] = decodeBytes(value);
      }
      for (const column of declaration.locationColumns ?? []) {
        if (column in row) row[column] = target.locationId;
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
      if (declaration.name === "printers") row.active = false;
      // An explicit column list with each value bound, in place of PostgreSQL's
      // `jsonb_populate_record`, which this engine does not have. Every key was checked against
      // `pragma_table_info` above, so `sql.identifier` names a real column of a real table and
      // nothing here is concatenated; the values bind, exactly as the jsonb document's did.
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
  await applyPreparedLocation(tx, target, {
    ...bundle.venue.location,
    catalogueId:
      bundle.venue.location.catalogueId === null
        ? null
        : (idMap.get(bundle.venue.location.catalogueId) ?? bundle.venue.location.catalogueId),
  });
}
