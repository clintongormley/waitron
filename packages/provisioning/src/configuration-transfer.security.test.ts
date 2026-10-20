import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { ALL_MODULES } from "@waitron/composition";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  enabledModules,
  type ConfigurationTransferTable,
  type WaitronModule,
} from "@waitron/module";
import { configurationBundle } from "../test/configuration-bundle.js";
import { request } from "../test/first-setup-request.js";
import {
  buildConfigurationBundle,
  exportConfigurationTables,
  importConfigurationTables,
  validateConfigurationBundle,
} from "./configuration-transfer.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
const now = new Date("2026-10-16T11:40:00Z");
const invalid = (field: string) => ({ code: "setup.request_invalid", params: { field } });

function transfer(tables: readonly ConfigurationTransferTable[]): WaitronModule {
  return {
    ...ALL_MODULES.find((module) => module.name === "fiscal-none")!,
    name: "synthetic-transfer",
    configurationTransfer: { kind: "tables", tables },
  };
}

function seed() {
  return applyVenue(
    planVenue(
      {
        ...request,
        country: "GB",
        taxId: "123456789",
        location: { ...request.location, fiscalTerritory: "GB-vat", timeZone: "Europe/London" },
        admin: {
          displayName: "Target owner",
          email: "target@example.test",
          pinHash: "synthetic-target-pin",
          passwordHash: "synthetic-target-password",
        },
      },
      modules,
    ),
    { db: suite.db, modules },
  );
}

it("exports the current business-day cutover without retaining an obsolete setting", async () => {
  const target = await seed();
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`insert into location_day_cutover_changes
      (location_id, effective_business_day, day_cutover)
      values (${target.locationId}, '2026-10-16', '04:30:00')`),
  );
  const bundle = await buildConfigurationBundle(suite.db, target, [], now, {});
  expect(bundle.venue.location.dayCutover).toBe("04:30:00");
  expect(bundle.venue.location.invoiceLocales).toEqual(["es-ES"]);
  expect(bundle.sourceOperatorId).toBe("");
});

it("refuses export while a future cutover change would be lost", async () => {
  const target = await seed();
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`insert into location_day_cutover_changes
      (location_id, effective_business_day, day_cutover)
      values (${target.locationId}, '2026-10-17', '04:30:00')`),
  );
  await expect(buildConfigurationBundle(suite.db, target, [], now, {})).rejects.toMatchObject(
    invalid("businessDayStart"),
  );
  expect(
    (await suite.db.execute(sql`select day_cutover from location_day_cutover_changes`)).rows,
  ).toEqual([{ day_cutover: "04:30:00" }]);
});

it.each(["standard", "full", "rectificative"])(
  "refuses export without an active %s series",
  async (purpose) => {
    const target = await seed();
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update invoice_series set retired_at = ${now.toISOString()}
        where purpose = ${purpose}`),
    );
    await expect(buildConfigurationBundle(suite.db, target, [], now, {})).rejects.toMatchObject(
      invalid("venue"),
    );
  },
);

it("refuses an export whose requested node does not belong to the stored venue", async () => {
  const target = await seed();
  await expect(
    buildConfigurationBundle(suite.db, { ...target, nodeId: "absent-node" }, [], now, {}),
  ).rejects.toMatchObject(invalid("venue"));
});

it("refuses a receipt-language list containing a non-string stored value", async () => {
  const target = await seed();
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`update locations set invoice_locales = '[1]' where id = ${target.locationId}`),
  );
  await expect(buildConfigurationBundle(suite.db, target, [], now, {})).rejects.toMatchObject(
    invalid("venue"),
  );
});

it.each(["missing-table", "unknown-column"])(
  "refuses %s before deleting any existing imported table",
  async (change) => {
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`create table zz_transfer_rows (id text primary key, name text)`);
      await tx.execute(sql`insert into zz_transfer_rows values ('retained', 'Keep this')`);
    });
    try {
      const bundle = configurationBundle();
      bundle.modules = { "synthetic-transfer": 1 };
      bundle.tables = {
        zz_transfer_rows: [{ id: "replacement", name: "Replacement" }],
        ...(change === "missing-table" ? { zz_missing: [] } : {}),
      };
      if (change === "unknown-column") bundle.tables.zz_transfer_rows![0]!.unknown = "unsafe";
      const module = transfer([
        { name: "zz_transfer_rows" },
        ...(change === "missing-table" ? [{ name: "zz_missing" }] : []),
      ]);
      await expect(
        withTransaction(suite.db, (tx) =>
          importConfigurationTables(tx, bundle, { locationId: "absent" }, [module], bundle.modules),
        ),
      ).rejects.toMatchObject(
        invalid(change === "missing-table" ? "table:zz_missing" : "table:zz_transfer_rows"),
      );
      expect((await suite.db.execute(sql`select * from zz_transfer_rows`)).rows).toEqual([
        { id: "retained", name: "Keep this" },
      ]);
    } finally {
      await withTransaction(suite.db, (tx) => tx.execute(sql`drop table zz_transfer_rows`));
    }
  },
);

it("imports staff without their source login credentials and preserves the target owner", async () => {
  const target = await seed();
  const ownerBefore = (await suite.db.execute(sql`select * from persons where role = 'admin'`))
    .rows;
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`insert into persons (id, display_name, role, status, created_at)
      values ('old-target-staff', 'Old staff', 'staff', 'active', ${now.toISOString()})`),
  );
  const bundle = configurationBundle();
  bundle.modules = { "synthetic-transfer": 1 };
  const staff = {
    id: "source-staff",
    display_name: "Imported staff",
    role: "staff",
    status: "active",
    created_at: now.toISOString(),
    pin_hash: "synthetic-source-pin",
    password_hash: "synthetic-source-password",
    totp_secret: "synthetic-source-totp",
    email: "staff@example.test",
    email_verified_at: now.toISOString(),
    google_subject: "synthetic-source-google",
    pending_email: "pending@example.test",
  };
  bundle.tables = {
    persons: [
      {
        ...staff,
        id: bundle.sourceOperatorId,
        display_name: "Source operator",
        email: "source-owner@example.test",
        role: "admin",
      },
      staff,
    ],
  };
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(
      tx,
      bundle,
      target,
      [transfer([{ name: "persons" }])],
      bundle.modules,
    ),
  );
  expect((await suite.db.execute(sql`select * from persons where role = 'admin'`)).rows).toEqual(
    ownerBefore,
  );
  const imported = (
    await suite.db.execute(sql`select id, display_name, pin_hash, password_hash,
    totp_secret, email, email_verified_at, google_subject, pending_email, status
    from persons where role <> 'admin'`)
  ).rows;
  expect(imported).toEqual([
    {
      id: expect.any(String),
      display_name: "Imported staff",
      pin_hash: expect.stringMatching(/^disabled-import:/),
      password_hash: null,
      totp_secret: null,
      email: "staff@example.test",
      email_verified_at: null,
      google_subject: null,
      pending_email: null,
      status: "suspended",
    },
  ]);
  expect(imported[0]!.id).not.toBe(staff.id);
});

it("omits the source operator's dependent rows while preserving another person's settings", async () => {
  const target = await seed();
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`create table zz_transfer_rows (id text primary key, person_id text, name text)`),
  );
  try {
    const bundle = configurationBundle();
    bundle.modules = { "synthetic-transfer": 1 };
    bundle.tables = {
      zz_transfer_rows: [
        { id: "operator-setting", person_id: bundle.sourceOperatorId, name: "Private operator" },
        { id: "staff-setting", person_id: "source-staff", name: "Staff setting" },
      ],
    };
    await withTransaction(suite.db, (tx) =>
      importConfigurationTables(
        tx,
        bundle,
        target,
        [transfer([{ name: "zz_transfer_rows" }])],
        bundle.modules,
      ),
    );
    expect(
      (await suite.db.execute(sql`select person_id, name from zz_transfer_rows`)).rows,
    ).toEqual([{ person_id: "source-staff", name: "Staff setting" }]);
  } finally {
    await withTransaction(suite.db, (tx) => tx.execute(sql`drop table zz_transfer_rows`));
  }
});

it("imports printers disabled with fresh agent credentials and no page-printer agent binding", async () => {
  const target = await seed();
  const bundle = configurationBundle();
  bundle.modules = { "synthetic-transfer": 1 };
  bundle.tables = {
    print_agents: [
      {
        id: "source-agent",
        location_id: "source-location",
        name: "Source worker",
        token_hash: "synthetic-source-token",
        active: true,
        enrolled_at: now.toISOString(),
      },
    ],
    printers: [
      {
        id: "source-receipt",
        location_id: "source-location",
        name: "Receipt printer",
        transport: "network_tcp",
        host: "192.0.2.10",
        active: true,
      },
    ],
    page_printers: [
      {
        id: "source-page",
        location_id: "source-location",
        name: "Office printer",
        host: "192.0.2.11",
        port: 631,
        resource_path: "/ipp/print",
        document_format: "application/pdf",
        supported_formats: '["application/pdf"]',
        media: "iso_a4_210x297mm",
        resolution_dpi: 300,
        active: true,
        agent_id: "source-agent",
      },
    ],
  };
  const module = transfer([
    { name: "print_agents", locationColumns: ["location_id"] },
    { name: "printers", locationColumns: ["location_id"] },
    { name: "page_printers", locationColumns: ["location_id"] },
  ]);
  await withTransaction(suite.db, (tx) =>
    importConfigurationTables(tx, bundle, target, [module], bundle.modules),
  );
  expect(
    (await suite.db.execute(sql`select id, location_id, token_hash, active from print_agents`))
      .rows,
  ).toEqual([
    {
      id: expect.any(String),
      location_id: target.locationId,
      token_hash: expect.stringMatching(/^disabled-import:/),
      active: 0,
    },
  ]);
  expect(
    (await suite.db.execute(sql`select name, location_id, active from printers`)).rows,
  ).toEqual([{ name: "Receipt printer", location_id: target.locationId, active: 0 }]);
  expect(
    (await suite.db.execute(sql`select name, location_id, active, agent_id from page_printers`))
      .rows,
  ).toEqual([
    { name: "Office printer", location_id: target.locationId, active: 0, agent_id: null },
  ]);
  expect((await suite.db.execute(sql`pragma foreign_key_check`)).rows).toEqual([]);
});

it("bounds both export and import row counts while permitting the exact maximum", async () => {
  const module = transfer([{ name: "zz_transfer_rows" }]);
  await withTransaction(suite.db, (tx) =>
    tx.execute(sql`create table zz_transfer_rows (id integer primary key)`),
  );
  try {
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
      with recursive n(x) as (values(1) union all select x+1 from n where x < 100000)
      insert into zz_transfer_rows select x from n`),
    );
    const exported = await exportConfigurationTables(suite.db, [module]);
    expect(exported.tables.zz_transfer_rows).toHaveLength(100000);
    expect(exported.tables.zz_transfer_rows![0]).toEqual({ id: 1 });
    expect(exported.tables.zz_transfer_rows!.at(-1)).toEqual({ id: 100000 });
    const bundle = configurationBundle();
    bundle.modules = { "synthetic-transfer": 1 };
    bundle.tables = exported.tables;
    expect(() => validateConfigurationBundle(bundle, [module], bundle.modules)).not.toThrow();
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`insert into zz_transfer_rows values (100001)`),
    );
    await expect(exportConfigurationTables(suite.db, [module])).rejects.toMatchObject(
      invalid("table:zz_transfer_rows"),
    );
    bundle.tables.zz_transfer_rows!.push({ id: 100001 });
    expect(() => validateConfigurationBundle(bundle, [module], bundle.modules)).toThrow(
      expect.objectContaining(invalid("table:zz_transfer_rows")),
    );
  } finally {
    await withTransaction(suite.db, (tx) => tx.execute(sql`drop table zz_transfer_rows`));
  }
});
