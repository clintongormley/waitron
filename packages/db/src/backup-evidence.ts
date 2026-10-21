import type { BackupQuery, BackupRow, BackupValue } from "@waitron/store";
import { SOURCES } from "@waitron/shared";
import { isMembershipDocument, verifyMembershipDocument } from "@waitron/membership";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { DeploymentEnvironment } from "./deployment.js";
import { CORE_CLASSIFICATION } from "./classification.js";
import { computeAmendmentHash } from "./order-amendment-hash.js";
import * as schema from "./schema/index.js";

export interface BackupTablePolicy {
  table: string;
  immutable: boolean;
  addedColumns: Readonly<Record<string, BackupValue>>;
}

function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function first(query: BackupQuery, statement: string, values?: readonly BackupValue[]) {
  for await (const row of query.rows(statement, values)) return row;
  return undefined;
}

async function hasTable(query: BackupQuery, name: string): Promise<boolean> {
  return (
    (await first(query, "select name from sqlite_schema where type = 'table' and name = ?", [
      name,
    ])) !== undefined
  );
}

function same(a: BackupValue | undefined, b: BackupValue | undefined): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) return Buffer.from(a).equals(b);
  return a === b;
}

export async function compareBackupTables(input: {
  before: BackupQuery;
  after: BackupQuery;
  policies: readonly BackupTablePolicy[];
}): Promise<boolean> {
  for (const policy of input.policies) {
    const table = ident(policy.table);
    const hasBefore = await hasTable(input.before, policy.table);
    if (!(await hasTable(input.after, policy.table))) return false;
    const afterSample = await first(input.after, `select * from ${table} limit 1`);
    const beforeSample = hasBefore
      ? await first(input.before, `select * from ${table} limit 1`)
      : undefined;
    if (beforeSample === undefined) {
      if (afterSample !== undefined) return false;
      continue;
    }
    if (afterSample === undefined) return false;
    const columns = Object.keys(beforeSample).sort();
    const added = Object.keys(afterSample).filter((name) => !columns.includes(name));
    if (
      columns.some((name) => !Object.hasOwn(afterSample, name)) ||
      added.some((name) => !Object.hasOwn(policy.addedColumns, name))
    )
      return false;
    // BINARY overrides a table's collation; hex breaks SQLite's INTEGER/REAL numeric ties.
    const order = columns
      .flatMap((name) => [`${ident(name)} collate binary`, `hex(${ident(name)}) collate binary`])
      .join(", ");
    const a = input.before.rows(`select * from ${table} order by ${order}`)[Symbol.asyncIterator]();
    const b = input.after.rows(`select * from ${table} order by ${order}`)[Symbol.asyncIterator]();
    try {
      while (true) {
        const left = await a.next();
        const right = await b.next();
        if (left.done || right.done) {
          if (left.done !== right.done) return false;
          break;
        }
        if (
          columns.some((name) => !same(left.value[name], right.value[name])) ||
          added.some((name) => !same(right.value[name], policy.addedColumns[name]))
        )
          return false;
      }
    } finally {
      try {
        await a.return?.();
      } finally {
        await b.return?.();
      }
    }
  }
  return true;
}

export const CORE_BACKUP_TABLE_POLICIES: readonly BackupTablePolicy[] = CORE_CLASSIFICATION.map(
  (entry) => ({
    table: entry.table,
    immutable:
      entry.appendOnly === true ||
      ["invoice_series", "working_order_counters", "daily_close_chain", "node_membership"].includes(
        entry.table,
      ),
    addedColumns: {},
  }),
);

async function referencesValid(query: BackupQuery): Promise<boolean> {
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const config = getTableConfig(value);
    if (!(await hasTable(query, config.name))) continue;
    for (const key of config.foreignKeys) {
      const { columns, foreignColumns, foreignTable } = key.reference();
      const present = columns
        .map((column) => `child.${ident(column.name)} is not null`)
        .join(" and ");
      const match = columns
        .map(
          (column, i) => `parent.${ident(foreignColumns[i]!.name)} = child.${ident(column.name)}`,
        )
        .join(" and ");
      const parent = getTableConfig(foreignTable).name;
      if (!(await hasTable(query, parent))) {
        if (
          await first(query, `select 1 from ${ident(config.name)} child where ${present} limit 1`)
        )
          return false;
        continue;
      }
      if (
        await first(
          query,
          `select 1 from ${ident(config.name)} child where ${present} and not exists (select 1 from ${ident(parent)} parent where ${match}) limit 1`,
        )
      )
        return false;
    }
  }
  return true;
}

async function membershipValid(query: BackupQuery): Promise<boolean> {
  const trust: Record<string, string> = Object.create(null) as Record<string, string>;
  for await (const row of query.rows(
    "select id, public_key from nodes where public_key is not null",
  )) {
    if (typeof row.id !== "string" || typeof row.public_key !== "string") return false;
    try {
      if (
        createPublicKey({ key: Buffer.from(row.public_key, "base64"), format: "der", type: "spki" })
          .asymmetricKeyType !== "ed25519"
      )
        return false;
    } catch {
      return false;
    }
    trust[row.id] = row.public_key;
  }
  if (!(await hasTable(query, "node_membership"))) return true;
  for await (const row of query.rows("select id, term, document from node_membership")) {
    if (row.id !== 1n || typeof row.document !== "string") return false;
    let document: unknown;
    try {
      document = JSON.parse(row.document);
    } catch {
      return false;
    }
    if (
      !isMembershipDocument(document) ||
      row.term !== BigInt(document.body.term) ||
      !verifyMembershipDocument(document, trust).valid
    )
      return false;
    for (const endorsement of document.endorsements) {
      if (
        Object.hasOwn(trust, endorsement.nodeId) &&
        trust[endorsement.nodeId] !== endorsement.publicKey
      )
        return false;
    }
  }
  return true;
}

function text(row: BackupRow, name: string): string | null {
  return typeof row[name] === "string" ? row[name] : null;
}

async function amendmentsValid(query: BackupQuery): Promise<boolean> {
  if (!(await hasTable(query, "order_amendments"))) return true;
  let order: string | null = null;
  let sequence = 0;
  let previous: string | null = null;
  for await (const row of query.rows(
    "select * from order_amendments order by working_order_id collate binary, sequence_no",
  )) {
    const id = text(row, "working_order_id");
    if (id === null) return false;
    if (id !== order) {
      order = id;
      sequence = 0;
      previous = null;
    }
    sequence++;
    const source = text(row, "captured_by_source");
    const actorId = text(row, "actor_id");
    const nodeId = text(row, "captured_by_node_id");
    const at = text(row, "event_at");
    const offset = row.event_offset_minutes;
    const kind = row.kind;
    if (
      row.sequence_no !== BigInt(sequence) ||
      row.is_first_entry !== (sequence === 1 ? 1n : 0n) ||
      row.prev_entry_hash !== previous ||
      (kind !== "order_placed" && kind !== "order_cancelled") ||
      actorId === null ||
      nodeId === null ||
      at === null ||
      !Number.isFinite(Date.parse(at)) ||
      typeof offset !== "bigint" ||
      offset < -840n ||
      offset > 840n ||
      source === null ||
      !(SOURCES as readonly string[]).includes(source) ||
      (row.reason !== null && typeof row.reason !== "string") ||
      (row.captured_by_device_id !== null && typeof row.captured_by_device_id !== "string")
    )
      return false;
    const hash = computeAmendmentHash({
      sequenceNo: sequence,
      workingOrderId: id,
      kind,
      actorId,
      reason: row.reason,
      capturedBySource: source as (typeof SOURCES)[number],
      capturedByDeviceId: row.captured_by_device_id,
      capturedByNodeId: nodeId,
      eventAt: at,
      eventOffsetMinutes: Number(offset),
      prevEntryHash: previous,
    });
    if (hash !== row.entry_hash) return false;
    previous = hash;
  }
  return true;
}

export async function verifyCoreBackupData(input: {
  before: BackupQuery;
  after: BackupQuery;
  nodeId: string;
  locationId: string;
  environment: DeploymentEnvironment;
}): Promise<boolean> {
  if (!(await compareBackupTables({ ...input, policies: CORE_BACKUP_TABLE_POLICIES })))
    return false;
  for (const query of [input.before, input.after]) {
    const deployment = await first(query, "select environment from deployment where id = 1");
    const node = await first(query, "select location_id from nodes where id = ?", [input.nodeId]);
    const location = await first(query, "select id from locations where id = ?", [
      input.locationId,
    ]);
    const tenant = await first(
      query,
      "select country, tax_id, legal_name from tenants where id = 1",
    );
    if (
      deployment?.environment !== input.environment ||
      node?.location_id !== input.locationId ||
      location === undefined ||
      tenant === undefined ||
      [tenant.country, tenant.tax_id, tenant.legal_name].some(
        (value) => typeof value !== "string" || value.length === 0,
      )
    )
      return false;
    if (!(await referencesValid(query))) return false;
    if (
      await first(
        query,
        "select 1 from sales s join invoice_series i on i.id = s.series_id where s.node_id <> i.node_id or s.invoice_number >= i.next_number limit 1",
      )
    )
      return false;
    if (!(await membershipValid(query)) || !(await amendmentsValid(query))) return false;
  }
  return true;
}

async function keylessMembership(query: BackupQuery, nodeId: string): Promise<boolean> {
  if (await hasTable(query, "node_roles")) {
    if (await first(query, "select 1 from node_roles where node_id = ? limit 1", [nodeId]))
      return false;
  }
  for await (const row of query.rows(
    "select endorsement from nodes where endorsement is not null",
  )) {
    if (typeof row.endorsement !== "string") return false;
    let endorsement: unknown;
    try {
      endorsement = JSON.parse(row.endorsement);
    } catch {
      return false;
    }
    if (
      endorsement === null ||
      typeof endorsement !== "object" ||
      Array.isArray(endorsement) ||
      !("endorsedBy" in endorsement) ||
      typeof endorsement.endorsedBy !== "string" ||
      endorsement.endorsedBy === nodeId
    )
      return false;
  }
  if (!(await hasTable(query, "node_membership"))) return true;
  for await (const row of query.rows("select document from node_membership")) {
    if (typeof row.document !== "string") return false;
    let document: unknown;
    try {
      document = JSON.parse(row.document);
    } catch {
      return false;
    }
    if (
      !isMembershipDocument(document) ||
      document.signerNodeId === nodeId ||
      document.body.nodes.some((node) => node.nodeId === nodeId) ||
      document.body.revoked?.includes(nodeId) ||
      document.endorsements.some((entry) => entry.nodeId === nodeId || entry.endorsedBy === nodeId)
    )
      return false;
  }
  return true;
}

export async function verifyBackupMembershipIdentity(input: {
  before: BackupQuery;
  after: BackupQuery;
  nodeId: string;
  privateKey: string | null;
}): Promise<boolean> {
  if (!(await hasTable(input.before, "nodes")) || !(await hasTable(input.after, "nodes")))
    return false;
  const before = await first(
    input.before,
    "select public_key, endorsement from nodes where id = ?",
    [input.nodeId],
  );
  const after = await first(input.after, "select public_key, endorsement from nodes where id = ?", [
    input.nodeId,
  ]);
  if (before === undefined || after === undefined || !same(before.public_key, after.public_key))
    return false;
  if (input.privateKey === null) {
    return (
      before.public_key === null &&
      before.endorsement === null &&
      after.endorsement === null &&
      (await keylessMembership(input.before, input.nodeId)) &&
      (await keylessMembership(input.after, input.nodeId))
    );
  }
  if (typeof before.public_key !== "string") return false;
  try {
    const bytes = Buffer.from(input.privateKey, "base64");
    if (bytes.toString("base64") !== input.privateKey) return false;
    const key = createPrivateKey({ key: bytes, format: "der", type: "pkcs8" });
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !key.export({ format: "der", type: "pkcs8" }).equals(bytes)
    )
      return false;
    return (
      createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64") ===
      before.public_key
    );
  } catch {
    return false;
  }
}
