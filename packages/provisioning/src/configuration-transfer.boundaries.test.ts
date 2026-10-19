import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  enabledModules,
  type ConfigurationTransferTable,
  type WaitronModule,
} from "@waitron/module";
import { sql } from "drizzle-orm";
import { configurationBundle } from "../test/configuration-bundle.js";
import { request } from "../test/first-setup-request.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import {
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  exportConfigurationTables,
  importConfigurationTables,
  validateConfigurationBundle,
} from "./configuration-transfer.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const passphrase = "SYNTHETIC transfer passphrase";
const invalid = (field: string) => ({ code: "setup.request_invalid", params: { field } });
function moduleWith(tables: readonly ConfigurationTransferTable[]): WaitronModule {
  return {
    ...ALL_MODULES.find((module) => module.name === "fiscal-none")!,
    name: "synthetic-transfer",
    configurationTransfer: { kind: "tables", tables },
  };
}
async function scratch(run: (tx: Transaction) => Promise<void>) {
  await withTransaction(suite.db, async (tx) => {
    try {
      await run(tx);
    } finally {
      await tx.execute(sql`drop table if exists zz_children`);
      await tx.execute(sql`drop table if exists zz_parents`);
    }
  });
}

it.each([
  { value: null, field: "artifact" },
  { value: [], field: "artifact" },
  { value: { version: 5 }, field: "version" },
  { value: { ...configurationBundle(), createdAt: "bad-date" }, field: "artifact" },
  { value: { ...configurationBundle(), modules: { module: -1 } }, field: "artifact" },
  { value: { ...configurationBundle(), reconnect: [3] }, field: "artifact" },
  {
    value: {
      ...configurationBundle(),
      venue: { ...configurationBundle().venue, taxpayerDomicile: 7 },
    },
    field: "artifact",
  },
  {
    value: {
      ...configurationBundle(),
      venue: {
        ...configurationBundle().venue,
        location: { ...configurationBundle().venue.location, invoiceLocales: [] },
      },
    },
    field: "artifact",
  },
  { value: { ...configurationBundle(), tables: [] }, field: "artifact" },
])("refuses malformed encrypted configuration: $field ($value)", ({ value, field }) => {
  const artifact = encryptArtifact(
    packArchive([{ name: "configuration.json", bytes: Buffer.from(JSON.stringify(value)) }]),
    passphrase,
  );
  expect(() => decodeConfigurationBundle(artifact, passphrase)).toThrow(
    expect.objectContaining(invalid(field)),
  );
});

it.each([
  {},
  { version: 2 },
  {
    ...configurationBundle(),
    venue: {
      ...configurationBundle().venue,
      location: { ...configurationBundle().venue.location, drawerOpenPolicy: "always" },
    },
  },
])("refuses an obsolete configuration format: %j", (value) => {
  const artifact = encryptArtifact(
    packArchive([{ name: "configuration.json", bytes: Buffer.from(JSON.stringify(value)) }]),
    passphrase,
  );
  expect(() => decodeConfigurationBundle(artifact, passphrase)).toThrow(
    expect.objectContaining({ code: "setup.configuration_outdated" }),
  );
});

it.each([
  [{ name: "other.json", bytes: Buffer.from("{}") }],
  [{ name: "configuration.json", bytes: Buffer.from("{") }],
  [
    { name: "configuration.json", bytes: Buffer.from("{}") },
    { name: "extra", bytes: Buffer.from("extra") },
  ],
])("refuses a changed archive entry or malformed JSON", (...entries) => {
  const artifact = encryptArtifact(packArchive(entries), passphrase);
  expect(() => decodeConfigurationBundle(artifact, passphrase)).toThrow(
    expect.objectContaining(invalid("artifact")),
  );
});

it("requires a usable passphrase and keeps the complete decoded configuration", () => {
  expect(() => encodeConfigurationBundle(configurationBundle(), "short")).toThrow(
    expect.objectContaining(invalid("passphrase")),
  );
  expect(
    decodeConfigurationBundle(
      encodeConfigurationBundle(configurationBundle(), passphrase),
      passphrase,
    ),
  ).toEqual(configurationBundle());
});

it.each([
  { declarations: [{ name: "zz_parents" }, { name: "zz_parents" }], field: "table:zz_parents" },
  { declarations: [{ name: "Bad-name" }], field: "table:Bad-name" },
  { declarations: [{ name: "zz_parents", before: ["missing"] }], field: "table:missing" },
  {
    declarations: [
      { name: "zz_parents", before: ["zz_children"] },
      { name: "zz_children", before: ["zz_parents"] },
    ],
    field: "table:zz_parents",
  },
])(
  "refuses an unusable declaration before reading the database: $field",
  async ({ declarations, field }) => {
    await expect(
      exportConfigurationTables(suite.db, [moduleWith(declarations)]),
    ).rejects.toMatchObject(invalid(field));
  },
);

it("refuses a module that omitted its transfer decision", async () => {
  const module = { ...moduleWith([]), configurationTransfer: undefined };
  await expect(exportConfigurationTables(suite.db, [module])).rejects.toMatchObject(
    invalid("module:synthetic-transfer"),
  );
  expect(
    await exportConfigurationTables(suite.db, [
      { ...module, configurationTransfer: { kind: "none" } },
    ]),
  ).toEqual({ tables: {}, reconnect: [] });
});

it("leaves dependent rows behind across a reverse-ordered composite key and strips private fields", async () => {
  await scratch(async (tx) => {
    await tx.execute(
      sql`create table zz_parents (id text, part text, active integer, private text, primary key (part, id))`,
    );
    await tx.execute(
      sql`create table zz_children (id text primary key, parent_part text, parent_id text, foreign key (parent_part, parent_id) references zz_parents)`,
    );
    await tx.execute(
      sql`insert into zz_parents values ('kept','one',1,'secret'),('gone','one',0,'secret')`,
    );
    await tx.execute(
      sql`insert into zz_children values ('live','one','kept'),('retired','one','gone'),('unbound',null,null)`,
    );
    const module = moduleWith([
      { name: "zz_children" },
      { name: "zz_parents", leaveBehindWhenFalse: "active", omit: ["private"], reconnect: true },
    ]);
    expect(await exportConfigurationTables(tx, [module])).toEqual({
      tables: {
        zz_children: [
          { id: "live", parent_part: "one", parent_id: "kept" },
          { id: "unbound", parent_part: null, parent_id: null },
        ],
        zz_parents: [{ id: "kept", part: "one", active: 1 }],
      },
      reconnect: ["zz_parents"],
    });
  });
});

it.each([
  {
    create: "create table zz_parents (id text primary key, gone text) without rowid",
    declaration: { name: "zz_parents", leaveBehindWhenSet: "gone" },
    field: "table:zz_parents",
  },
  {
    create: "create table zz_parents (id text primary key)",
    declaration: { name: "zz_parents", leaveBehindWhenSet: "gone" },
    field: "zz_parents.gone",
  },
  {
    create: "create table zz_parents (id text primary key, rowid text, gone text)",
    declaration: { name: "zz_parents", leaveBehindWhenSet: "gone" },
    field: "zz_parents.rowid",
  },
  {
    create: "create table zz_parents (id text primary key, __export_rowid text, gone text)",
    declaration: { name: "zz_parents", leaveBehindWhenSet: "gone" },
    field: "zz_parents.__export_rowid",
  },
])(
  "refuses an export whose selector cannot be paired with real rows: $field",
  async ({ create, declaration, field }) => {
    await scratch(async (tx) => {
      await tx.execute(sql.raw(create));
      await expect(
        exportConfigurationTables(tx, [moduleWith([declaration])]),
      ).rejects.toMatchObject(invalid(field));
    });
  },
);

it.each([
  { change: { modules: { extra: 1 } }, field: "modules" },
  { change: { modules: { "synthetic-transfer": 2 } }, field: "module:synthetic-transfer" },
  { change: { tables: { secret: [] } }, field: "tables" },
  { change: { tables: {} }, field: "table:zz_parents" },
  { change: { tables: { zz_parents: [null] } }, field: "table:zz_parents" },
  { change: { tables: { zz_parents: [[]] } }, field: "table:zz_parents" },
  { change: { tables: { zz_parents: [{ private: "secret" }] } }, field: "zz_parents.private" },
])("refuses unexpected schema or private input before any write: $field", ({ change, field }) => {
  const bundle = { ...configurationBundle(), modules: { "synthetic-transfer": 1 }, ...change };
  expect(() =>
    validateConfigurationBundle(
      bundle as never,
      [moduleWith([{ name: "zz_parents", omit: ["private"] }])],
      { "synthetic-transfer": 1 },
    ),
  ).toThrow(expect.objectContaining(invalid(field)));
});

it("checks an import's module version before replacing its existing rows", async () => {
  await scratch(async (tx) => {
    await tx.execute(sql`create table zz_parents (id text primary key)`);
    await tx.execute(sql`insert into zz_parents values ('retained')`);
    const bundle = configurationBundle();
    bundle.modules = { "synthetic-transfer": 99 };
    bundle.tables = { zz_parents: [{ id: "replacement" }] };
    await expect(
      importConfigurationTables(
        tx,
        bundle,
        { locationId: "absent" },
        [moduleWith([{ name: "zz_parents" }])],
        { "synthetic-transfer": 1 },
      ),
    ).rejects.toMatchObject(invalid("module:synthetic-transfer"));
    expect((await tx.execute(sql`select id from zz_parents`)).rows).toEqual([{ id: "retained" }]);
  });
});

it("imports fresh ids and actual bytes without rewriting ordinary text that resembles either", async () => {
  const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
  const target = await applyVenue(
    planVenue(
      {
        ...request,
        country: "GB",
        taxId: "123456789",
        location: { ...request.location, fiscalTerritory: "GB-vat", timeZone: "Europe/London" },
        admin: {
          displayName: "Owner",
          email: "owner@example.test",
          pinHash: "synthetic-pin",
          passwordHash: "synthetic-password",
        },
      },
      modules,
    ),
    { db: suite.db, modules },
  );
  await scratch(async (tx) => {
    await tx.execute(
      sql`create table zz_parents (id text primary key, location_id text, name text, bytes blob, enabled integer)`,
    );
    await tx.execute(
      sql`create table zz_children (id text primary key, parent_id text references zz_parents(id), note text)`,
    );
    const bundle = configurationBundle();
    bundle.tables = {
      zz_parents: [
        {
          id: "old-id",
          location_id: "source-location",
          name: "old-id",
          bytes: "\\x0001ff",
          enabled: true,
        },
      ],
      zz_children: [{ id: "old-child", parent_id: "old-id", note: "\\x0001ff" }],
    };
    bundle.modules = { "synthetic-transfer": 1 };
    const module = moduleWith([
      { name: "zz_children" },
      { name: "zz_parents", before: ["zz_children"], locationColumns: ["location_id"] },
    ]);
    await importConfigurationTables(tx, bundle, target, [module], bundle.modules);
    const parent = (
      await tx.execute<Record<string, unknown>>(
        sql`select id, location_id, name, hex(bytes) as bytes, typeof(bytes) as storage, enabled from zz_parents`,
      )
    ).rows[0]!;
    expect(parent).toEqual({
      id: expect.any(String),
      location_id: target.locationId,
      name: "old-id",
      bytes: "0001FF",
      storage: "blob",
      enabled: 1,
    });
    expect(parent.id).not.toBe("old-id");
    const child = (await tx.execute(sql`select id, parent_id, note from zz_children`)).rows[0]!;
    expect(child).toEqual({ id: expect.any(String), parent_id: parent.id, note: "\\x0001ff" });
    expect(child.id).not.toBe("old-child");
    expect((await tx.execute(sql`pragma foreign_key_check`)).rows).toEqual([]);
  });
});
