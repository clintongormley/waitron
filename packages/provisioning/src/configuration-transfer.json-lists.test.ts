import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules, type WaitronModule } from "@waitron/module";
import { sql } from "drizzle-orm";
import { configurationBundle } from "../test/configuration-bundle.js";
import { request } from "../test/first-setup-request.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import { exportConfigurationTables, importConfigurationTables } from "./configuration-transfer.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const destination = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const module: WaitronModule = {
  ...ALL_MODULES.find((m) => m.name === "fiscal-none")!,
  name: "synthetic-transfer",
  configurationTransfer: {
    kind: "tables",
    tables: [
      { name: "zz_targets", leaveBehindWhenFalse: "active", before: ["zz_owners"] },
      {
        name: "zz_owners",
        jsonReferences: [
          { column: "ids", paths: [["*"]] },
          {
            column: "doc",
            paths: [
              ["*", "ids", "*"],
              ["*", "defaultId"],
              ["*", "stationIds", "*"],
            ],
          },
        ],
      },
    ],
  },
};

async function scratch(run: (tx: Transaction) => Promise<void>, checks = true) {
  await withTransaction(suite.db, async (tx) => {
    try {
      await tx.execute(
        sql`create table zz_targets (id text primary key, active integer not null default 1)`,
      );
      await tx.execute(
        checks
          ? sql`create table zz_owners (id text primary key, ids text check(json_valid(ids) and json_type(ids) = 'array'), doc text not null default '{}' check(json_valid(doc) and json_type(doc) = 'object'))`
          : sql`create table zz_owners (id text primary key, ids text, doc text not null default '{}')`,
      );
      await run(tx);
    } finally {
      await tx.execute(sql`drop table if exists zz_owners`);
      await tx.execute(sql`drop table if exists zz_targets`);
    }
  });
}

it("export prunes left-behind and missing ids, retaining the owner and unrelated text", async () => {
  await scratch(async (tx) => {
    await tx.execute(sql`insert into zz_targets values ('A',1),('B',0)`);
    await tx.execute(
      sql`insert into zz_owners values ('owner', '["A","B","gone"]', '{"r":{"ids":["B","A"],"defaultId":"B","note":"B"}}'), ('empty','["B"]','{}')`,
    );
    const result = await exportConfigurationTables(tx, [module]);
    expect(result.tables.zz_targets).toEqual([{ id: "A", active: 1 }]);
    expect(result.tables.zz_owners).toEqual([
      { id: "owner", ids: '["A"]', doc: '{"r":{"ids":["A"],"defaultId":null,"note":"B"}}' },
      { id: "empty", ids: "[]", doc: "{}" },
    ]);
    expect((await tx.execute(sql`select ids from zz_owners where id='owner'`)).rows).toEqual([
      { ids: '["A","B","gone"]' },
    ]);
  });
});

it("export preserves whole-column, intermediate and leaf nulls and skips missing paths", async () => {
  await scratch(async (tx) => {
    await tx.execute(sql`insert into zz_targets values ('A',1)`);
    const doc = '{"r":{"ids":["A"],"defaultId":null},"v":{"stationIds":null}}';
    await tx.execute(sql`insert into zz_owners values ('owner',null,${doc})`);
    expect((await exportConfigurationTables(tx, [module])).tables.zz_owners).toEqual([
      { id: "owner", ids: null, doc },
    ]);
  });
});

it.each(["nope", "[3]", '[{"x":1}]'])("export refuses invalid id data %s", async (ids) => {
  await scratch(async (tx) => {
    await tx.execute(sql`insert into zz_owners values ('owner',${ids},'{}')`);
    await expect(exportConfigurationTables(tx, [module])).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "zz_owners.ids" },
    });
  }, false);
});

async function prepareVenue(db = suite.db) {
  const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
  await applyVenue(
    planVenue(
      {
        ...request,
        country: "GB",
        taxId: "123456789",
        fiscalTerritory: "GB-vat",
        timeZone: "Europe/London",
        admin: {
          displayName: "Owner",
          email: "owner@example.test",
          pinHash: "synthetic-pin",
          passwordHash: "synthetic-password",
        },
      },
      modules,
    ),
    { db, modules },
  );
}

function bundleWith(ids: string | null, doc = "{}") {
  const bundle = configurationBundle();
  bundle.modules = { "synthetic-transfer": 1 };
  bundle.tables = {
    zz_targets: [
      { id: "old-A", active: 1 },
      { id: "old-B", active: 1 },
    ],
    zz_owners: [{ id: "owner", ids, doc }],
  };
  return bundle;
}

it("import rewrites ids at declared paths and preserves unrelated text and nulls", async () => {
  await prepareVenue();
  await scratch(async (tx) => {
    const bundle = bundleWith(
      '["old-A","old-B"]',
      '{"r":{"ids":["old-B"],"defaultId":"old-B","note":"old-A"},"s":{"ids":[],"defaultId":null},"v":{"stationIds":null}}',
    );
    await importConfigurationTables(tx, bundle, [module], bundle.modules);
    const targets = (
      await tx.execute<{ id: string }>(sql`select id from zz_targets order by rowid`)
    ).rows;
    const [a, b] = targets.map((r) => r.id);
    expect(a).not.toBe("old-A");
    expect(b).not.toBe("old-B");
    const row = (await tx.execute<{ ids: string; doc: string }>(sql`select ids,doc from zz_owners`))
      .rows[0]!;
    expect(JSON.parse(row.ids)).toEqual([a, b]);
    expect(JSON.parse(row.doc)).toEqual({
      r: { ids: [b], defaultId: b, note: "old-A" },
      s: { ids: [], defaultId: null },
      v: { stationIds: null },
    });
    expect((await tx.execute(sql`pragma foreign_key_check`)).rows).toEqual([]);
  });
});

it("import preserves a whole-column null", async () => {
  await prepareVenue();
  await scratch(async (tx) => {
    const bundle = bundleWith(null);
    await importConfigurationTables(tx, bundle, [module], bundle.modules);
    expect((await tx.execute(sql`select ids from zz_owners`)).rows).toEqual([{ ids: null }]);
  });
});

it("round trips surviving ids into a second venue without carrying source ids", async () => {
  await prepareVenue(destination.db);
  await scratch(async (tx) => {
    await tx.execute(sql`insert into zz_targets values ('A',1),('B',0)`);
    await tx.execute(
      sql`insert into zz_owners values ('owner','["A","B"]','{"r":{"ids":["A","B"],"defaultId":"A"}}')`,
    );
    const exported = await exportConfigurationTables(tx, [module]);
    const bundle = bundleWith("[]");
    bundle.tables = exported.tables;
    await withTransaction(destination.db, async (target) => {
      try {
        await target.execute(
          sql`create table zz_targets (id text primary key, active integer not null default 1)`,
        );
        await target.execute(
          sql`create table zz_owners (id text primary key, ids text, doc text not null default '{}')`,
        );
        await importConfigurationTables(target, bundle, [module], bundle.modules);
        const ids = (await target.execute<{ id: string }>(sql`select id from zz_targets`)).rows.map(
          (r) => r.id,
        );
        expect(ids).toHaveLength(1);
        expect(ids).not.toContain("A");
        expect(ids).not.toContain("B");
        const row = (
          await target.execute<{ ids: string; doc: string }>(sql`select ids,doc from zz_owners`)
        ).rows[0]!;
        expect(JSON.parse(row.ids)).toEqual(ids);
        expect(JSON.parse(row.doc)).toEqual({ r: { ids, defaultId: ids[0] } });
      } finally {
        await target.execute(sql`drop table if exists zz_owners`);
        await target.execute(sql`drop table if exists zz_targets`);
      }
    });
  });
});

it.each([
  { ids: '["old-A","elsewhere"]', doc: "{}", field: "ids" },
  { ids: "[3]", doc: "{}", field: "ids" },
  { ids: "[]", doc: '{"r":{"ids":[{"x":1}]}}', field: "doc" },
  { ids: "nope", doc: "{}", field: "ids" },
])("import refuses invalid references in $field ($ids)", async ({ ids, doc, field }) => {
  await prepareVenue();
  // Catch outside the transaction: no partial owner or target may survive a refusal.
  await suite.db.execute(
    sql`create table zz_targets (id text primary key, active integer not null default 1)`,
  );
  await suite.db.execute(
    sql`create table zz_owners (id text primary key, ids text, doc text not null default '{}')`,
  );
  try {
    const bundle = bundleWith(ids, doc);
    await expect(
      withTransaction(suite.db, (tx) =>
        importConfigurationTables(tx, bundle, [module], bundle.modules),
      ),
    ).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: `zz_owners.${field}` },
    });
    expect((await suite.db.execute(sql`select * from zz_owners`)).rows).toEqual([]);
    expect((await suite.db.execute(sql`select * from zz_targets`)).rows).toEqual([]);
  } finally {
    await suite.db.execute(sql`drop table zz_owners`);
    await suite.db.execute(sql`drop table zz_targets`);
  }
});
