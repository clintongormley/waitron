import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openBackupQuery, type BackupQuery, type BackupValue } from "@waitron/store";
import { generateNodeKeyPair, signDocumentBody, endorseKey } from "@waitron/membership";
import crypto, { generateKeyPairSync } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { jobOrigin } from "@waitron/shared";
import {
  compareBackupTables,
  verifyCoreBackupData,
  verifyBackupMembershipIdentity,
  CORE_BACKUP_TABLE_POLICIES,
} from "./backup-evidence.js";
import { CORE_CLASSIFICATION } from "./classification.js";
import { appendOrderAmendment } from "./append-order-amendment.js";
import { withTransaction } from "./tenancy.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "./testing/venue-db.js";

describe("complete backup table comparison", () => {
  const before = useVenueDb({
    migrations: [],
    setup: async (db) => {
      db.run(sql.raw("create table evidence (id, value, note)"));
    },
  });
  const after = useVenueDb({
    migrations: [],
    setup: async (db) => {
      db.run(sql.raw("create table evidence (id, value, note)"));
    },
  });
  afterEach(() => {
    for (const db of [before.db, after.db]) {
      db.run(sql`drop table if exists evidence`);
      db.run(sql`create table evidence (id, value, note)`);
    }
  });

  async function compare(addedColumns: Readonly<Record<string, BackupValue>> = {}) {
    return queries(before.db, after.db, (a, b) =>
      compareBackupTables({
        before: a,
        after: b,
        policies: [{ table: "evidence", immutable: true, addedColumns }],
      }),
    );
  }

  it("detects same-count immutable replacement and non-hash field changes", async () => {
    for (const db of [before.db, after.db])
      db.run(sql`insert into evidence values ('one', 'hash', 'original')`);
    expect(await compare()).toBe(true);
    after.db.run(sql`update evidence set note = 'replacement'`);
    expect(await compare()).toBe(false);
    after.db.run(sql`update evidence set note = 'original', id = 'two'`);
    expect(await compare()).toBe(false);
  });

  it("compares unordered multisets with duplicate multiplicities", async () => {
    before.db.run(sql`insert into evidence values (1, 'x', null), (1, 'x', null), (2, 'y', null)`);
    after.db.run(sql`insert into evidence values (2, 'y', null), (1, 'x', null), (1, 'x', null)`);
    expect(await compare()).toBe(true);
    after.db.run(sql`delete from evidence where rowid = (select max(rowid) from evidence)`);
    after.db.run(sql`insert into evidence values (2, 'y', null)`);
    expect(await compare()).toBe(false);
  });

  it.each([
    ["null", "''"],
    ["1", "'1'"],
    ["1", "1.0"],
    ["x'31'", "'1'"],
    ["9007199254740992", "9007199254740993"],
    ["'1.00'", "'1.0'"],
  ])("preserves SQLite value types and exact values: %s / %s", async (a, b) => {
    before.db.run(sql.raw(`insert into evidence values (1, ${a}, 'same')`));
    after.db.run(sql.raw(`insert into evidence values (1, ${a}, 'same')`));
    expect(await compare()).toBe(true);
    after.db.run(sql.raw(`update evidence set value = ${b}`));
    expect(await compare()).toBe(false);
  });

  it("orders equal numeric values consistently despite their storage type", async () => {
    before.db.run(sql`insert into evidence values (1, 1, null), (1, 1.0, null)`);
    after.db.run(sql`insert into evidence values (1, 1.0, null), (1, 1, null)`);
    expect(await compare()).toBe(true);
  });

  it("refuses a lost or added row, including a completely emptied target", async () => {
    for (const db of [before.db, after.db]) db.run(sql`insert into evidence values (1, 'x', null)`);
    after.db.run(sql`insert into evidence values (2, 'y', null)`);
    expect(await compare()).toBe(false);
    after.db.run(sql`delete from evidence`);
    expect(await compare()).toBe(false);
  });

  it("releases the second real cursor even if the first cursor's cleanup fails", async () => {
    before.db.run(sql`insert into evidence values (1, 'before', null), (2, 'tail', null)`);
    after.db.run(sql`insert into evidence values (1, 'after', null), (2, 'tail', null)`);
    await queries(before.db, after.db, async (a, b) => {
      let target: AsyncIterator<Readonly<Record<string, BackupValue>>> | undefined;
      const wrappedBefore: BackupQuery = {
        rows(statement, values) {
          const iterator = a.rows(statement, values)[Symbol.asyncIterator]();
          if (!statement.includes("order by")) return { [Symbol.asyncIterator]: () => iterator };
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => iterator.next(),
              async return() {
                await iterator.return?.();
                throw new Error("Fixture cursor cleanup failed");
              },
            }),
          };
        },
      };
      const wrappedAfter: BackupQuery = {
        rows(statement, values) {
          const iterator = b.rows(statement, values)[Symbol.asyncIterator]();
          if (statement.includes("order by")) target = iterator;
          return { [Symbol.asyncIterator]: () => iterator };
        },
      };
      await expect(
        compareBackupTables({
          before: wrappedBefore,
          after: wrappedAfter,
          policies: [{ table: "evidence", immutable: true, addedColumns: {} }],
        }),
      ).rejects.toThrow("Fixture cursor cleanup failed");
      expect(await target!.next()).toEqual({ done: true, value: undefined });
    });
  });

  it("escapes arbitrary identifiers without interpreting them as SQL", async () => {
    const table = 'evidence"; drop table evidence; --';
    for (const db of [before.db, after.db]) {
      db.run(sql.raw(`create table ${quote(table)} (value text collate nocase)`));
      db.run(
        db === before.db
          ? sql`insert into ${sql.raw(quote(table))} values ('a'), ('A')`
          : sql`insert into ${sql.raw(quote(table))} values ('A'), ('a')`,
      );
    }
    try {
      await queries(before.db, after.db, async (a, b) => {
        const policies = [{ table, immutable: true, addedColumns: {} }];
        expect(await compareBackupTables({ before: a, after: b, policies })).toBe(true);
        after.db.run(sql`update ${sql.raw(quote(table))} set value = 'a'`);
        expect(await compareBackupTables({ before: a, after: b, policies })).toBe(false);
      });
      expect(after.db.all(sql`select count(*) as count from evidence`)).toEqual([{ count: 0 }]);
    } finally {
      for (const db of [before.db, after.db]) db.run(sql.raw(`drop table ${quote(table)}`));
    }
  });

  it("admits only explicitly declared additive defaults", async () => {
    for (const db of [before.db, after.db])
      db.run(sql`insert into evidence values (1, x'00ff', null)`);
    after.db.run(sql`alter table evidence add column extra integer default 7`);
    expect(await compare()).toBe(false);
    expect(await compare({ extra: 7n })).toBe(true);
    after.db.run(sql`update evidence set extra = 8`);
    expect(await compare({ extra: 7n })).toBe(false);
  });

  it("never hides changes to an original column behind an additive default", async () => {
    before.db.run(sql`insert into evidence values (1, 'old', null)`);
    after.db.run(sql`insert into evidence values (1, 'new', null)`);
    expect(await compare({ value: "new" })).toBe(false);
  });

  it("refuses dropped original columns and missing original tables", async () => {
    for (const db of [before.db, after.db]) db.run(sql`insert into evidence values (1, 'x', null)`);
    after.db.run(sql`alter table evidence drop column note`);
    expect(await compare()).toBe(false);
    after.db.run(sql`drop table evidence`);
    expect(await compare()).toBe(false);
    after.db.run(sql`create table evidence (id, value, note)`);
  });

  it("admits a new empty table but refuses invented rows", async () => {
    before.db.run(sql`drop table evidence`);
    try {
      expect(await compare()).toBe(true);
      after.db.run(sql`insert into evidence values (1, 'invented', null)`);
      expect(await compare()).toBe(false);
    } finally {
      before.db.run(sql`create table evidence (id, value, note)`);
    }
  });
});

async function queries<T>(
  before: ReturnType<typeof useVenueDb>["db"],
  after: ReturnType<typeof useVenueDb>["db"],
  body: (a: BackupQuery, b: BackupQuery) => Promise<T>,
): Promise<T> {
  const file = (db: typeof before) =>
    db.all<{ file: string }>(sql`pragma database_list`).find((r) => r.file.endsWith("venue.db"))!
      .file;
  const a = await openBackupQuery(file(before));
  try {
    const b = await openBackupQuery(file(after));
    try {
      return await body(a.query, b.query);
    } finally {
      await b.close();
    }
  } finally {
    await a.close();
  }
}

describe("core backup source binding", () => {
  const before = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const after = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  function seed() {
    for (const db of [before.db, after.db]) {
      db.run(
        sql`insert into tenants (id, country, tax_id, legal_name, created_at) values (1, 'GB', 'fixture-id', 'Fixture company', '2026-10-20T00:00:00Z')`,
      );
      db.run(
        sql`insert into locations (id, name, invoice_locales, operation_description) values ('venue', 'Fixture venue', '["en"]', 'Restaurant')`,
      );
      db.run(
        sql`insert into nodes (id, location_id, name, created_at) values ('source', 'venue', 'Source node', '2026-10-20T00:00:00Z')`,
      );
      db.run(
        sql`insert into deployment (id, environment, stamped_at) values (1, 'preproduction', '2026-10-20T00:00:00Z')`,
      );
      db.run(
        sql`insert into invoice_series (id, node_id, code, next_number, retired_at) values ('old', 'source', 'HISTORY', 91, '2026-10-19T00:00:00Z'), ('live', 'source', 'CURRENT', 4, null)`,
      );
    }
  }
  async function verify(
    binding = { nodeId: "source", locationId: "venue", environment: "preproduction" as const },
  ) {
    return queries(before.db, after.db, (a, b) =>
      verifyCoreBackupData({ before: a, after: b, ...binding }),
    );
  }

  it("accepts bound source data and genuinely empty optional histories", async () => {
    seed();
    expect(await verify()).toBe(true);
    expect(after.db.all(sql`select * from node_membership`)).toEqual([]);
    expect(after.db.all(sql`select * from daily_close_chain`)).toEqual([]);
  });

  it.each(["node_membership", "order_amendments", "purchase_invoice_vat", "purchase_invoices"])(
    "accepts an explicitly empty new target table absent from the source: %s",
    async (table) => {
      seed();
      const definition = before.db.all<{ sql: string }>(
        sql`select sql from sqlite_schema where type = 'table' and name = ${table}`,
      )[0]!.sql;
      const indexes = before.db.all<{ sql: string }>(
        sql`select sql from sqlite_schema where type = 'index' and tbl_name = ${table} and sql is not null`,
      );
      const restore = dropTriggers(before.db, table);
      before.db.run(sql`drop table ${sql.raw(quote(table))}`);
      try {
        await expect(verify()).resolves.toBe(true);
        if (table === "purchase_invoices") {
          for (const db of [before.db, after.db]) {
            db.run(sql`pragma foreign_keys = off`);
            try {
              db.run(
                sql`insert into purchase_invoice_vat (id, purchase_invoice_id, rate, base, tax) values ('dangling', 'missing', 0, 0, 0)`,
              );
            } finally {
              db.run(sql`pragma foreign_keys = on`);
            }
          }
          await expect(verify()).resolves.toBe(false);
        }
      } finally {
        before.db.run(sql.raw(definition));
        for (const index of indexes) before.db.run(sql.raw(index.sql));
        restore();
      }
    },
  );

  it.each(["nodeId", "locationId"] as const)(
    "source identity %s disagreement refuses",
    async (field) => {
      seed();
      expect(
        await verify({
          nodeId: "source",
          locationId: "venue",
          environment: "preproduction",
          [field]: "other",
        }),
      ).toBe(false);
    },
  );

  it("source environment disagreement refuses", async () => {
    seed();
    for (const db of [before.db, after.db])
      db.run(sql`update deployment set environment = 'production'`);
    expect(await verify()).toBe(false);
  });

  it.each(["country", "tax_id", "legal_name"])(
    "refuses missing source taxpayer %s",
    async (column) => {
      seed();
      for (const db of [before.db, after.db])
        db.run(sql`update tenants set ${sql.raw(quote(column))} = ''`);
      expect(await verify()).toBe(false);
    },
  );

  it.each(["old", "live"])("preserves every historical and live series counter: %s", async (id) => {
    seed();
    expect(await verify()).toBe(true);
    after.db.run(sql`update invoice_series set next_number = next_number + 1 where id = ${id}`);
    expect(await verify()).toBe(false);
  });

  it("rejects a sale beyond its retained series counter", async () => {
    seed();
    for (const db of [before.db, after.db])
      db.run(
        sql`insert into sales (id, source, device_id, series_id, node_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values ('sale', 'operator_script', null, 'live', 'source', 4, '2026-10-20T00:00:00.000Z', 0, 100, '[]', 'en', '["en"]', 'fixture', 'not_applicable')`,
      );
    expect(await verify()).toBe(false);
    for (const db of [before.db, after.db])
      db.run(sql`update invoice_series set next_number = 5 where id = 'live'`);
    expect(await verify()).toBe(true);
  });

  it("rejects captured dangling references even when both copies match", async () => {
    seed();
    for (const db of [before.db, after.db]) {
      db.run(sql`pragma foreign_keys = off`);
      try {
        db.run(sql`update invoice_series set node_id = 'missing' where id = 'old'`);
      } finally {
        db.run(sql`pragma foreign_keys = on`);
      }
    }
    expect(await verify()).toBe(false);
  });

  it("verifies the captured membership signature and denormalized term", async () => {
    seed();
    const keys = generateNodeKeyPair();
    const body = {
      term: 7,
      nodes: [
        {
          nodeId: "source",
          contactUrl: "https://fixture.invalid",
          standing: "serving-primary" as const,
        },
      ],
    };
    const document = {
      body,
      signerNodeId: "source",
      endorsements: [],
      signature: signDocumentBody(body, keys.privateKey),
    };
    for (const db of [before.db, after.db]) {
      db.run(sql`update nodes set public_key = ${keys.publicKey}`);
      db.run(
        sql`insert into node_membership (id, term, document, updated_at) values (1, 7, ${JSON.stringify(document)}, '2026-10-20T00:00:00Z')`,
      );
    }
    expect(await verify()).toBe(true);
    for (const db of [before.db, after.db]) db.run(sql`update node_membership set term = 8`);
    expect(await verify()).toBe(false);
    for (const db of [before.db, after.db])
      db.run(
        sql`update node_membership set term = 7, document = ${JSON.stringify({ ...document, signature: "invalid" })}`,
      );
    expect(await verify()).toBe(false);
  });

  it.each(["{", "null", '{"body":{}}', 1, new Uint8Array([0xff])])(
    "refuses malformed captured membership: %s",
    async (document) => {
      seed();
      for (const db of [before.db, after.db])
        db.run(
          sql`insert into node_membership (id, term, document, updated_at) values (1, 7, ${document}, '2026-10-20T00:00:00Z')`,
        );
      expect(await verify()).toBe(false);
    },
  );

  it.each([
    "invalid",
    new Uint8Array([0xff]),
    generateKeyPairSync("x25519")
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64"),
  ])("refuses unusable captured membership public keys: %s", async (key) => {
    seed();
    for (const db of [before.db, after.db]) db.run(sql`update nodes set public_key = ${key}`);
    expect(await verify()).toBe(false);
  });

  it("refuses an endorsement that contradicts the captured node key", async () => {
    seed();
    const keys = generateNodeKeyPair();
    const body = {
      term: 1,
      nodes: [
        {
          nodeId: "source",
          contactUrl: "https://fixture.invalid",
          standing: "serving-primary" as const,
        },
      ],
    };
    const document = {
      body,
      signerNodeId: "source",
      signature: signDocumentBody(body, keys.privateKey),
      endorsements: [
        {
          nodeId: "source",
          publicKey: generateNodeKeyPair().publicKey,
          endorsedBy: "source",
          signature: "unused",
        },
      ],
    };
    for (const db of [before.db, after.db]) {
      db.run(sql`update nodes set public_key = ${keys.publicKey}`);
      db.run(
        sql`insert into node_membership (id, term, document, updated_at) values (1, 1, ${JSON.stringify(document)}, '2026-10-20T00:00:00Z')`,
      );
    }
    expect(await verify()).toBe(false);
    document.endorsements[0]!.publicKey = keys.publicKey;
    for (const db of [before.db, after.db])
      db.run(sql`update node_membership set document = ${JSON.stringify(document)}`);
    expect(await verify()).toBe(true);
  });

  it.each([
    ["sequence_no", 2],
    ["is_first_entry", 0],
    ["prev_entry_hash", "A".repeat(64)],
    ["kind", "unexpected"],
    ["actor_id", new Uint8Array([1])],
    ["captured_by_node_id", new Uint8Array([1])],
    ["event_at", new Uint8Array([1])],
    ["event_at", "invalid"],
    ["event_offset_minutes", "invalid"],
    ["event_offset_minutes", -841],
    ["event_offset_minutes", 841],
    ["captured_by_source", new Uint8Array([1])],
    ["captured_by_source", "unexpected"],
    ["reason", new Uint8Array([1])],
    ["captured_by_device_id", new Uint8Array([1])],
  ] as const)("refuses malformed amendment %s = %s", async (column, value) => {
    seed();
    for (const db of [before.db, after.db]) {
      db.run(
        sql`insert into working_orders (id, source, location_id, node_id, order_number, opened_at) values ('order', 'dashboard', 'venue', 'source', 1, '2026-10-20T00:00:00.000Z')`,
      );
    }
    await withTransaction(before.db, (tx) =>
      appendOrderAmendment(tx, {
        workingOrderId: "order",
        kind: "order_placed",
        actorId: "operator",
        reason: null,
        origin: jobOrigin("dashboard"),
        capturedByNodeId: "source",
        eventAt: new Date("2026-10-20T00:00:00Z"),
        eventOffsetMinutes: 0,
      }),
    );
    copyTable(before.db, after.db, "order_amendments");
    expect(await verify()).toBe(true);
    for (const db of [before.db, after.db]) {
      const restore = dropTriggers(db, "order_amendments");
      db.run(sql`pragma ignore_check_constraints = on`);
      db.run(sql`pragma foreign_keys = off`);
      try {
        db.run(sql`update order_amendments set ${sql.raw(quote(column))} = ${value}`);
      } finally {
        restore();
        db.run(sql`pragma ignore_check_constraints = off`);
        db.run(sql`pragma foreign_keys = on`);
      }
    }
    expect(await verify()).toBe(false);
  });

  it("walks every order amendment chain, including historical middle damage", async () => {
    seed();
    for (const id of ["old-order", "new-order"]) {
      for (const db of [before.db, after.db])
        db.run(
          sql`insert into working_orders (id, source, location_id, node_id, order_number, opened_at) values (${id}, 'dashboard', 'venue', 'source', ${id === "old-order" ? 1 : 2}, '2026-10-20T00:00:00.000Z')`,
        );
      for (let i = 0; i < 3; i++)
        await withTransaction(before.db, (tx) =>
          appendOrderAmendment(tx, {
            workingOrderId: id,
            kind: i === 0 ? "order_placed" : "order_cancelled",
            actorId: "operator",
            reason: i === 0 ? null : "Fixture cancellation",
            origin: jobOrigin("dashboard"),
            capturedByNodeId: "source",
            eventAt: new Date("2026-10-20T00:00:00Z"),
            eventOffsetMinutes: 0,
          }),
        );
    }
    copyTable(before.db, after.db, "order_amendments");
    expect(await verify()).toBe(true);
    for (const db of [before.db, after.db]) {
      const restore = dropTriggers(db, "order_amendments");
      try {
        db.run(
          sql`update order_amendments set reason = 'Tampered middle' where working_order_id = 'old-order' and sequence_no = 2`,
        );
      } finally {
        restore();
      }
    }
    expect(await verify()).toBe(false);
  });

  it("retains captured heads and refuses a deleted target head without recreating it", async () => {
    seed();
    for (const db of [before.db, after.db])
      db.run(
        sql`insert into daily_close_chain (node_id, sequence_no, last_entry_hash) values ('source', 3, ${"A".repeat(64)})`,
      );
    expect(await verify()).toBe(true);
    after.db.run(sql`delete from daily_close_chain`);
    expect(await verify()).toBe(false);
    expect(after.db.all(sql`select * from daily_close_chain`)).toEqual([]);
  });
  it("refuses missing identity without creating a missing head", async () => {
    expect(
      await queries(before.db, after.db, (a, b) =>
        verifyCoreBackupData({
          before: a,
          after: b,
          nodeId: "source",
          locationId: "venue",
          environment: "preproduction",
        }),
      ),
    ).toBe(false);
    expect(before.db.all(sql`select * from daily_close_chain`)).toEqual([]);
    expect(after.db.all(sql`select * from daily_close_chain`)).toEqual([]);
  });
});

describe("generated complete core preservation", () => {
  const before = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const after = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  it("checks every classified table and every captured column, including all append-only evidence", async () => {
    const restores: (() => void)[] = [];
    try {
      for (const db of [before.db, after.db]) {
        db.run(sql`pragma foreign_keys = off`);
        db.run(sql`pragma ignore_check_constraints = on`);
        for (const { table } of CORE_CLASSIFICATION) {
          restores.push(dropTriggers(db, table));
          const columns = db.all<{ name: string; type: string }>(
            sql.raw(`pragma table_info(${quote(table)})`),
          );
          expect(columns.length, table).toBeGreaterThan(0);
          db.run(
            sql`insert into ${sql.raw(quote(table))} (${sql.raw(columns.map((c) => quote(c.name)).join(", "))}) values (${sql.join(
              columns.map((c) => sql`${c.type.includes("INT") ? 1 : "captured"}`),
              sql`, `,
            )})`,
          );
        }
      }
      await queries(before.db, after.db, async (a, b) => {
        for (const { table } of CORE_CLASSIFICATION) {
          const policies = CORE_BACKUP_TABLE_POLICIES.filter((policy) => policy.table === table);
          expect(await compareBackupTables({ before: a, after: b, policies }), table).toBe(true);
          const columns = after.db.all<{ name: string; type: string }>(
            sql.raw(`pragma table_info(${quote(table)})`),
          );
          for (const column of columns) {
            const value = column.type.includes("INT") ? 1 : "captured";
            const changed = column.type.includes("INT") ? 2 : "changed";
            after.db.run(
              sql`update ${sql.raw(quote(table))} set ${sql.raw(quote(column.name))} = ${changed}`,
            );
            expect(
              await compareBackupTables({ before: a, after: b, policies }),
              `${table}.${column.name}`,
            ).toBe(false);
            after.db.run(
              sql`update ${sql.raw(quote(table))} set ${sql.raw(quote(column.name))} = ${value}`,
            );
          }
        }
      });
    } finally {
      for (const restore of restores) restore();
      for (const db of [before.db, after.db]) {
        db.run(sql`pragma ignore_check_constraints = off`);
        db.run(sql`pragma foreign_keys = on`);
      }
    }
  });
});

function quote(name: string) {
  return `"${name.replaceAll('"', '""')}"`;
}
function dropTriggers(db: ReturnType<typeof useVenueDb>["db"], table: string) {
  const triggers = db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_schema where type = 'trigger' and tbl_name = ${table}`,
  );
  for (const row of triggers) db.run(sql.raw(`drop trigger ${quote(row.name)}`));
  return () => {
    for (const row of triggers) db.run(sql.raw(row.sql));
  };
}
function copyTable(
  before: ReturnType<typeof useVenueDb>["db"],
  after: typeof before,
  table: string,
) {
  for (const row of before.all<Record<string, BackupValue>>(
    sql.raw(`select * from ${quote(table)}`),
  )) {
    after.run(
      sql`insert into ${sql.raw(quote(table))} (${sql.raw(Object.keys(row).map(quote).join(", "))}) values (${sql.join(
        Object.values(row).map((v) => sql`${v}`),
        sql`, `,
      )})`,
    );
  }
}

describe("backup membership private/public identity", () => {
  const before = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const after = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const pair = generateKeyPairSync("ed25519");
  const foreign = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const publicKey = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  function seed(key: string | null = publicKey) {
    for (const suite of [before, after]) {
      suite.db.run(
        sql`insert into locations (id,name,invoice_locales,operation_description) values ('venue','Fixture venue','["en"]','Restaurant')`,
      );
      suite.db.run(
        sql`insert into nodes (id,location_id,name,public_key,created_at) values ('source','venue','Source',${key},'2026-10-20T00:00:00Z')`,
      );
    }
  }
  const verify = (key: string | null = privateKey) =>
    queries(before.db, after.db, (a, b) =>
      verifyBackupMembershipIdentity({ before: a, after: b, nodeId: "source", privateKey: key }),
    );

  it("matching source identity passes without signing generating or writing", async () => {
    seed();
    const original = before.db.all(sql`select * from nodes`);
    const signer = vi.spyOn(crypto, "sign").mockImplementation(() => {
      throw new Error("Signing is forbidden");
    });
    const generator = vi.spyOn(crypto, "generateKeyPairSync").mockImplementation(() => {
      throw new Error("Generation is forbidden");
    });
    const asyncGenerator = vi.spyOn(crypto, "generateKeyPair").mockImplementation(() => {
      throw new Error("Generation is forbidden");
    });
    syncBuiltinESMExports();
    try {
      expect(await verify()).toBe(true);
      expect(signer).not.toHaveBeenCalled();
      expect(generator).not.toHaveBeenCalled();
      expect(asyncGenerator).not.toHaveBeenCalled();
      expect(before.db.all(sql`select * from nodes`)).toEqual(original);
      expect(after.db.all(sql`select * from nodes`)).toEqual(original);
    } finally {
      vi.restoreAllMocks();
      syncBuiltinESMExports();
    }
  });
  it.each([
    "not-base64",
    "",
    Buffer.from("not a key").toString("base64"),
    privateKey + "\n",
    privateKey + "=",
    Buffer.concat([Buffer.from(privateKey, "base64"), Buffer.from([0])]).toString("base64"),
  ])("malformed or noncanonical PKCS8 refuses: %s", async (key) => {
    seed();
    expect(await verify(key)).toBe(false);
  });
  it("valid unrelated Ed25519 private key refuses", async () => {
    seed();
    expect(
      await verify(foreign.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")),
    ).toBe(false);
  });
  it("a valid non-Ed25519 PKCS8 refuses", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    seed(other.publicKey.export({ format: "der", type: "spki" }).toString("base64"));
    expect(
      await verify(other.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")),
    ).toBe(false);
  });
  it("one missing key half refuses", async () => {
    seed();
    expect(await verify(null)).toBe(false);
    for (const suite of [before, after]) suite.db.run(sql`update nodes set public_key=null`);
    expect(await verify()).toBe(false);
  });
  it.each(["changed", "null", "absent"])(
    "compares both captured and migrated public halves: %s",
    async (mode) => {
      seed();
      if (mode === "absent") after.db.run(sql`delete from nodes`);
      else
        after.db.run(
          sql`update nodes set public_key=${mode === "null" ? null : foreign.publicKey.export({ format: "der", type: "spki" }).toString("base64")}`,
        );
      expect(await verify()).toBe(false);
    },
  );
  it("explicit keyless source is accepted only without membership obligations", async () => {
    seed(null);
    expect(await verify(null)).toBe(true);
    before.db.run(
      sql`insert into node_roles (node_id,mode,updated_at) values ('source','primary','2026-10-20T00:00:00Z')`,
    );
    expect(await verify(null)).toBe(false);
  });
  it("keyless source with retained endorsement refuses", async () => {
    seed(null);
    after.db.run(sql`update nodes set endorsement='{}'`);
    expect(await verify(null)).toBe(false);
  });
  it("missing source is not an explicitly keyless source", async () => {
    expect(await verify(null)).toBe(false);
  });
  it.each(["unrelated", "member", "signer", "endorsed", "endorser", "revoked"])(
    "keyless source accounts for retained document obligations: %s",
    async (mode) => {
      seed(null);
      const keys = generateNodeKeyPair();
      const body = {
        term: 1,
        nodes: [
          {
            nodeId: mode === "member" ? "source" : "other",
            contactUrl: "https://other.invalid",
            standing: "serving-primary" as const,
          },
        ],
        ...(mode === "revoked" ? { revoked: ["source"] } : {}),
      };
      const document = {
        body,
        signerNodeId: mode === "signer" ? "source" : "other",
        signature: signDocumentBody(body, keys.privateKey),
        endorsements:
          mode === "endorsed"
            ? [endorseKey("source", publicKey, "other", keys.privateKey)]
            : mode === "endorser"
              ? [endorseKey("third", publicKey, "source", privateKey)]
              : [],
      };
      for (const suite of [before, after]) {
        suite.db.run(
          sql`insert into nodes (id,location_id,name,public_key,created_at) values ('other','venue','Other',${keys.publicKey},'2026-10-20T00:00:00Z')`,
        );
        suite.db.run(
          sql`insert into node_membership (id,term,document,updated_at) values (1,1,${JSON.stringify(document)},'2026-10-20T00:00:00Z')`,
        );
      }
      expect(await verify(null)).toBe(mode === "unrelated");
    },
  );
  it.each(["{broken", "null", "{}"])(
    "malformed captured membership cannot justify keyless admission: %s",
    async (document) => {
      seed(null);
      after.db.run(
        sql`insert into node_membership (id,term,document,updated_at) values (1,1,${document},'2026-10-20T00:00:00Z')`,
      );
      expect(await verify(null)).toBe(false);
    },
  );
  it.each(["source", "other"])(
    "keyless source inspects who endorsed other retained nodes: %s",
    async (endorser) => {
      seed(null);
      const keys = generateNodeKeyPair();
      const endorsement = endorseKey("other", keys.publicKey, endorser, privateKey);
      before.db.run(
        sql`insert into nodes (id,location_id,name,public_key,endorsement,created_at) values ('other','venue','Other',${keys.publicKey},${JSON.stringify(endorsement)},'2026-10-20T00:00:00Z')`,
      );
      expect(await verify(null)).toBe(endorser !== "source");
    },
  );
  it.each(["{broken", "null", "1", "[]", "{}", '{"endorsedBy":1}', Buffer.from("blob")])(
    "malformed other-node endorsements cannot justify keyless admission: %s",
    async (endorsement) => {
      seed(null);
      before.db.run(
        sql`insert into nodes (id,location_id,name,endorsement,created_at) values ('other','venue','Other',${endorsement},'2026-10-20T00:00:00Z')`,
      );
      expect(await verify(null)).toBe(false);
    },
  );
  it("binary document bytes cannot justify keyless admission", async () => {
    seed(null);
    before.db.run(
      sql`insert into node_membership (id,term,document,updated_at) values (1,1,${Buffer.from("{}")},'2026-10-20T00:00:00Z')`,
    );
    expect(await verify(null)).toBe(false);
  });
  it("noncanonical public material and a different source identity refuse", async () => {
    seed(publicKey + "\n");
    expect(await verify()).toBe(false);
    expect(
      await queries(before.db, after.db, (a, b) =>
        verifyBackupMembershipIdentity({ before: a, after: b, nodeId: "unrecorded", privateKey }),
      ),
    ).toBe(false);
  });
});

describe("membership source with no captured table or optional membership state", () => {
  const missing = useVenueDb({ migrations: [] });
  const keyless = useVenueDb({
    migrations: [],
    resetPerTest: false,
    setup: async (db) => {
      db.run("create table nodes (id text, public_key text, endorsement text)");
      db.run("insert into nodes values ('source',null,null)");
    },
  });
  it("does not infer a keyless source from an absent node table on either side", async () => {
    for (const [a, b] of [
      [missing.db, keyless.db],
      [keyless.db, missing.db],
    ]) {
      expect(
        await queries(a!, b!, (before, after) =>
          verifyBackupMembershipIdentity({ before, after, nodeId: "source", privateKey: null }),
        ),
      ).toBe(false);
    }
  });
  it("admits an explicit keyless node before optional membership tables exist", async () => {
    expect(
      await queries(keyless.db, keyless.db, (before, after) =>
        verifyBackupMembershipIdentity({ before, after, nodeId: "source", privateKey: null }),
      ),
    ).toBe(true);
  });
});
